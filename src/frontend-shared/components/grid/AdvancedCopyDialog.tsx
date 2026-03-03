import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { GridColumnDef } from '../../../shared/types/grid'
import { gridStore } from '../../stores/grid'
import type { AdvancedCopyDelimiter, AdvancedCopyOptions, AdvancedCopyValueFormat } from '../../stores/grid'
import Dialog from '../common/Dialog'
import './AdvancedCopyDialog.css'

interface AdvancedCopyDialogProps {
	open: boolean
	tabId: string
	visibleColumns: GridColumnDef[]
	onClose: () => void
}

const DEFAULT_OPTIONS: AdvancedCopyOptions = {
	delimiter: 'tab',
	customDelimiter: '',
	includeHeaders: true,
	includeRowNumbers: false,
	valueFormat: 'displayed',
	nullRepresentation: '',
}

/** Session-level memory for last used settings. */
let sessionOptions: AdvancedCopyOptions = { ...DEFAULT_OPTIONS }

const MAX_PREVIEW_ROWS = 5

export default function AdvancedCopyDialog(props: AdvancedCopyDialogProps) {
	const [delimiter, setDelimiter] = createSignal<AdvancedCopyDelimiter>(sessionOptions.delimiter)
	const [customDelimiter, setCustomDelimiter] = createSignal(sessionOptions.customDelimiter)
	const [includeHeaders, setIncludeHeaders] = createSignal(sessionOptions.includeHeaders)
	const [includeRowNumbers, setIncludeRowNumbers] = createSignal(sessionOptions.includeRowNumbers)
	const [valueFormat, setValueFormat] = createSignal<AdvancedCopyValueFormat>(sessionOptions.valueFormat)
	const [nullRepresentation, setNullRepresentation] = createSignal(sessionOptions.nullRepresentation)
	const [copied, setCopied] = createSignal(false)

	// Reset state from session memory when dialog opens
	createEffect(() => {
		if (props.open) {
			setDelimiter(sessionOptions.delimiter)
			setCustomDelimiter(sessionOptions.customDelimiter)
			setIncludeHeaders(sessionOptions.includeHeaders)
			setIncludeRowNumbers(sessionOptions.includeRowNumbers)
			setValueFormat(sessionOptions.valueFormat)
			setNullRepresentation(sessionOptions.nullRepresentation)
			setCopied(false)
		}
	})

	const currentOptions = createMemo((): AdvancedCopyOptions => ({
		delimiter: delimiter(),
		customDelimiter: customDelimiter(),
		includeHeaders: includeHeaders(),
		includeRowNumbers: includeRowNumbers(),
		valueFormat: valueFormat(),
		nullRepresentation: nullRepresentation(),
	}))

	const preview = createMemo(() => {
		if (!props.open) return ''
		const tab = gridStore.getTab(props.tabId)
		if (!tab || tab.selectedRows.size === 0) return ''

		// Limit preview to first N rows
		const sorted = [...tab.selectedRows].sort((a, b) => a - b)
		const previewIndices = sorted.slice(0, MAX_PREVIEW_ROWS)
		const truncated = sorted.length > MAX_PREVIEW_ROWS

		// Build a temporary limited selection for preview
		const text = gridStore.buildAdvancedCopyText(
			props.tabId,
			props.visibleColumns,
			currentOptions(),
		)
		if (!text) return ''

		// Trim to preview rows
		const lines = text.split('\n')
		const headerOffset = includeHeaders() ? 1 : 0
		const previewLines = lines.slice(0, previewIndices.length + headerOffset)
		if (truncated) {
			previewLines.push('...')
		}
		return previewLines.join('\n')
	})

	const selectedRowCount = createMemo(() => {
		const tab = gridStore.getTab(props.tabId)
		return tab?.selectedRows.size ?? 0
	})

	function saveToSession() {
		sessionOptions = { ...currentOptions() }
	}

	async function handleCopy() {
		const text = gridStore.buildAdvancedCopyText(
			props.tabId,
			props.visibleColumns,
			currentOptions(),
		)
		if (!text) return

		try {
			await navigator.clipboard.writeText(text)
			saveToSession()
			setCopied(true)
			setTimeout(() => props.onClose(), 400)
		} catch {
			// Clipboard API may fail in some contexts
		}
	}

	const delimiterButtons: { value: AdvancedCopyDelimiter; label: string }[] = [
		{ value: 'tab', label: 'Tab' },
		{ value: 'comma', label: 'Comma' },
		{ value: 'semicolon', label: 'Semicolon' },
		{ value: 'pipe', label: 'Pipe' },
		{ value: 'custom', label: 'Custom' },
	]

	const valueFormatButtons: { value: AdvancedCopyValueFormat; label: string }[] = [
		{ value: 'displayed', label: 'As Displayed' },
		{ value: 'raw', label: 'Raw' },
		{ value: 'quoted', label: 'Quoted' },
	]

	const nullPresets: { value: string; label: string }[] = [
		{ value: '', label: '(empty)' },
		{ value: 'NULL', label: 'NULL' },
		{ value: '\\N', label: '\\N' },
	]

	return (
		<Dialog open={props.open} title="Advanced Copy" onClose={props.onClose}>
			<div class="adv-copy">
				<div class="adv-copy__section">
					<span class="adv-copy__label">Delimiter</span>
					<div class="adv-copy__btn-group">
						{delimiterButtons.map((btn) => (
							<button
								class="adv-copy__btn"
								classList={{ 'adv-copy__btn--active': delimiter() === btn.value }}
								onClick={() => setDelimiter(btn.value)}
							>
								{btn.label}
							</button>
						))}
					</div>
					<Show when={delimiter() === 'custom'}>
						<input
							type="text"
							class="adv-copy__input adv-copy__input--small"
							placeholder="e.g. |"
							value={customDelimiter()}
							onInput={(e) => setCustomDelimiter(e.currentTarget.value)}
						/>
					</Show>
				</div>

				<div class="adv-copy__section">
					<span class="adv-copy__label">Options</span>
					<label class="adv-copy__checkbox-label">
						<input
							type="checkbox"
							checked={includeHeaders()}
							onChange={(e) => setIncludeHeaders(e.currentTarget.checked)}
						/>
						Include column headers
					</label>
					<label class="adv-copy__checkbox-label">
						<input
							type="checkbox"
							checked={includeRowNumbers()}
							onChange={(e) => setIncludeRowNumbers(e.currentTarget.checked)}
						/>
						Include row numbers
					</label>
				</div>

				<div class="adv-copy__section">
					<span class="adv-copy__label">Value Format</span>
					<div class="adv-copy__btn-group">
						{valueFormatButtons.map((btn) => (
							<button
								class="adv-copy__btn"
								classList={{ 'adv-copy__btn--active': valueFormat() === btn.value }}
								onClick={() => setValueFormat(btn.value)}
							>
								{btn.label}
							</button>
						))}
					</div>
				</div>

				<div class="adv-copy__section">
					<span class="adv-copy__label">NULL Representation</span>
					<div class="adv-copy__field">
						<select
							class="adv-copy__select"
							value={nullPresets.find((p) => p.value === nullRepresentation()) ? nullRepresentation() : '__custom__'}
							onChange={(e) => {
								const val = e.currentTarget.value
								if (val !== '__custom__') {
									setNullRepresentation(val)
								}
							}}
						>
							{nullPresets.map((p) => <option value={p.value}>{p.label}</option>)}
							<option value="__custom__">Custom...</option>
						</select>
						<Show when={!nullPresets.find((p) => p.value === nullRepresentation())}>
							<input
								type="text"
								class="adv-copy__input adv-copy__input--small"
								placeholder="Custom..."
								value={nullRepresentation()}
								onInput={(e) => setNullRepresentation(e.currentTarget.value)}
							/>
						</Show>
					</div>
				</div>

				<div class="adv-copy__section">
					<span class="adv-copy__label">Preview</span>
					<pre class="adv-copy__preview">{preview() || "No rows selected"}</pre>
				</div>

				<div class="adv-copy__actions">
					<span class="adv-copy__info">{selectedRowCount()} row{selectedRowCount() !== 1 ? 's' : ''} selected</span>
					<button class="btn btn--ghost" onClick={props.onClose}>Cancel</button>
					<button
						class="btn btn--primary"
						onClick={handleCopy}
						disabled={selectedRowCount() === 0}
					>
						{copied() ? 'Copied!' : 'Copy'}
					</button>
				</div>
			</div>
		</Dialog>
	)
}
