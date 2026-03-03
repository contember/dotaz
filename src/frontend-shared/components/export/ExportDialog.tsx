import Download from 'lucide-solid/icons/download'
import Eye from 'lucide-solid/icons/eye'
import { createEffect, createSignal, For, Show } from 'solid-js'
import type { CsvDelimiter, CsvEncoding, ExportFormat, ExportPreviewRequest } from '../../../shared/types/export'
import type { ColumnFilter, SortColumn } from '../../../shared/types/grid'
import { getCapabilities } from '../../lib/capabilities'
import { rpc } from '../../lib/rpc'
import { transport } from '../../lib/transport'
import { gridStore } from '../../stores/grid'
import Dialog from '../common/Dialog'
import './ExportDialog.css'

type ExportScope = 'all' | 'view' | 'selected'

interface ExportDialogProps {
	open: boolean
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
	initialScope?: ExportScope
	onClose: () => void
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
	csv: 'CSV',
	json: 'JSON',
	sql: 'SQL INSERT',
	markdown: 'Markdown',
	sql_update: 'SQL UPDATE',
	html: 'HTML',
	xml: 'XML',
}

const ENCODING_LABELS: Record<CsvEncoding, string> = {
	'utf-8': 'UTF-8',
	'iso-8859-1': 'ISO-8859-1 (Latin-1)',
	'windows-1252': 'Windows-1252',
}

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
	',': 'Comma (,)',
	';': 'Semicolon (;)',
	'\t': 'Tab',
}

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
	csv: 'csv',
	json: 'json',
	sql: 'sql',
	markdown: 'md',
	sql_update: 'sql',
	html: 'html',
	xml: 'xml',
}

export default function ExportDialog(props: ExportDialogProps) {
	const [format, setFormat] = createSignal<ExportFormat>('csv')
	const [scope, setScope] = createSignal<ExportScope>('all')
	const [delimiter, setDelimiter] = createSignal<CsvDelimiter>(',')
	const [encoding, setEncoding] = createSignal<CsvEncoding>('utf-8')
	const [utf8Bom, setUtf8Bom] = createSignal(false)
	const [includeHeaders, setIncludeHeaders] = createSignal(true)
	const [batchSize, setBatchSize] = createSignal(100)
	const [preview, setPreview] = createSignal('')
	const [previewLoading, setPreviewLoading] = createSignal(false)
	const [exporting, setExporting] = createSignal(false)
	const [progressRows, setProgressRows] = createSignal(0)
	const [exportResult, setExportResult] = createSignal<
		{
			rowCount: number
			filePath?: string
			sizeBytes: number
		} | null
	>(null)
	const [error, setError] = createSignal<string | null>(null)

	const caps = () => getCapabilities()
	const tab = () => gridStore.getTab(props.tabId)

	const hasSelection = () => {
		const t = tab()
		return t ? t.selectedRows.size > 0 : false
	}

	const hasPrimaryKey = () => {
		const t = tab()
		if (!t) return false
		return t.columns.some((c) => c.isPrimaryKey)
	}

	const selectedRowCount = () => {
		const t = tab()
		return t ? t.selectedRows.size : 0
	}

	const rowCountForScope = () => {
		const t = tab()
		if (!t) return 0
		if (scope() === 'selected') return selectedRowCount()
		if (scope() === 'view' && t.filters.length > 0) return t.totalCount
		return t.totalCount
	}

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			setFormat('csv')
			setScope(props.initialScope ?? 'all')
			setDelimiter(',')
			setEncoding('utf-8')
			setUtf8Bom(false)
			setIncludeHeaders(true)
			setBatchSize(100)
			setPreview('')
			setPreviewLoading(false)
			setExporting(false)
			setProgressRows(0)
			setExportResult(null)
			setError(null)
		}
	})

	function getExportFilters(): ColumnFilter[] | undefined {
		const t = tab()
		if (!t) return undefined

		if (scope() === 'all') return undefined
		if (scope() === 'view') {
			return t.filters.length > 0 ? t.filters : undefined
		}

		// Selected rows: construct IN filter from PK values
		if (scope() === 'selected') {
			const pkCols = t.columns.filter((c) => c.isPrimaryKey)
			if (pkCols.length === 0) return undefined

			const selectedIndices = [...t.selectedRows].sort((a, b) => a - b)
			const filters: ColumnFilter[] = []

			for (const pkCol of pkCols) {
				const values = selectedIndices.map((i) => t.rows[i]?.[pkCol.name])
				filters.push({
					column: pkCol.name,
					operator: 'in',
					value: values,
				})
			}

			return filters
		}

		return undefined
	}

	function getExportSort(): SortColumn[] | undefined {
		const t = tab()
		if (!t) return undefined
		if (scope() === 'all') return undefined
		if (scope() === 'view') {
			return t.sort.length > 0 ? t.sort : undefined
		}
		return undefined
	}

	async function loadPreview() {
		setPreviewLoading(true)
		setPreview('')
		setError(null)

		try {
			const params: ExportPreviewRequest = {
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: format(),
				limit: 10,
				delimiter: format() === 'csv' ? delimiter() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			}

			const result = await rpc.export.preview(params)
			setPreview(result.content)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setPreviewLoading(false)
		}
	}

	async function handleExport() {
		setError(null)
		setExportResult(null)
		setProgressRows(0)

		const ext = FILE_EXTENSIONS[format()]
		const defaultName = `${props.table}.${ext}`

		// Web mode: use HTTP streaming via token
		if (caps().hasHttpStreaming && !caps().hasFileSystem) {
			return handleWebExport(defaultName)
		}

		let exportFilePath: string | undefined

		// Desktop: use native save dialog to get file path
		if (caps().hasFileSystem && caps().hasNativeDialogs) {
			try {
				const saveResult = await rpc.system.showSaveDialog({
					title: 'Export Data',
					defaultName,
					filters: [{ name: FORMAT_LABELS[format()], extensions: [ext] }],
				})

				if (saveResult.cancelled || !saveResult.path) return
				exportFilePath = saveResult.path
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				return
			}
		}

		setExporting(true)

		// Subscribe to progress events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'export.progress',
			(payload) => setProgressRows(payload.rowCount),
		)

		try {
			const result = await rpc.export.exportData({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: format(),
				filePath: exportFilePath ?? defaultName,
				delimiter: format() === 'csv' ? delimiter() : undefined,
				encoding: format() === 'csv' ? encoding() : undefined,
				utf8Bom: format() === 'csv' && encoding() === 'utf-8' ? utf8Bom() : undefined,
				includeHeaders: format() === 'csv' ? includeHeaders() : undefined,
				batchSize: format() === 'sql' ? batchSize() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			})

			setExportResult(result)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			unsub()
			setExporting(false)
		}
	}

	async function handleWebExport(defaultName: string) {
		setExporting(true)

		// Subscribe to progress and completion events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'export.progress',
			(payload) => setProgressRows(payload.rowCount),
		)

		let completionReceived = false
		const unsubComplete = transport.addMessageListener<{ rowCount: number }>(
			'export.complete',
			(payload) => {
				completionReceived = true
				setExportResult({ rowCount: payload.rowCount, sizeBytes: 0 })
				setExporting(false)
			},
		)

		try {
			// Get a stream token via WS RPC
			const { token } = await transport.call<{ token: string }>('stream.createExportToken', {
				connectionId: props.connectionId,
				database: props.database,
				schema: props.schema,
				table: props.table,
				format: format(),
				delimiter: format() === 'csv' ? delimiter() : undefined,
				encoding: format() === 'csv' ? encoding() : undefined,
				utf8Bom: format() === 'csv' && encoding() === 'utf-8' ? utf8Bom() : undefined,
				includeHeaders: format() === 'csv' ? includeHeaders() : undefined,
				batchSize: format() === 'sql' ? batchSize() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
			})

			// Trigger browser download via hidden anchor tag
			const a = document.createElement('a')
			a.href = `/api/stream/export/${token}`
			a.download = defaultName
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)

			// Wait for completion signal with a timeout
			// If no completion after 500ms and no progress, show as started
			await new Promise<void>((resolve) => {
				const check = () => {
					if (completionReceived) {
						resolve()
						return
					}
					// Keep waiting while we're getting progress
					setTimeout(check, 1000)
				}
				// For anchor-based downloads, we can't detect stream end precisely.
				// Show the download as started after a brief delay if no completion yet.
				setTimeout(() => {
					if (!completionReceived && !error()) {
						setExporting(false)
						setExportResult({ rowCount: progressRows(), sizeBytes: 0 })
					}
					resolve()
				}, 3000)
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setExporting(false)
		} finally {
			// Clean up listeners after a delay to catch late messages
			setTimeout(() => {
				unsub()
				unsubComplete()
			}, 5000)
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	}

	function formatNumber(n: number): string {
		return n.toLocaleString()
	}

	return (
		<Dialog
			open={props.open}
			title="Export Data"
			onClose={props.onClose}
		>
			<div class="export-dialog">
				{/* Format selection */}
				<div class="export-dialog__section">
					<label class="export-dialog__label">Format</label>
					<div class="export-dialog__format-group">
						<For each={Object.entries(FORMAT_LABELS) as [ExportFormat, string][]}>
							{([fmt, label]) => (
								<button
									class="export-dialog__format-btn"
									classList={{ 'export-dialog__format-btn--active': format() === fmt }}
									onClick={() => setFormat(fmt)}
								>
									{label}
								</button>
							)}
						</For>
					</div>
				</div>

				{/* Scope selection */}
				<div class="export-dialog__section">
					<label class="export-dialog__label">Scope</label>
					<div class="export-dialog__scope-group">
						<label class="export-dialog__radio-label">
							<input
								type="radio"
								name="scope"
								value="all"
								checked={scope() === 'all'}
								onChange={() => setScope('all')}
							/>
							Entire table
						</label>
						<label class="export-dialog__radio-label">
							<input
								type="radio"
								name="scope"
								value="view"
								checked={scope() === 'view'}
								onChange={() => setScope('view')}
							/>
							Current view (with filters)
						</label>
						<label
							class="export-dialog__radio-label"
							classList={{ 'export-dialog__radio-label--disabled': !hasSelection() || !hasPrimaryKey() }}
						>
							<input
								type="radio"
								name="scope"
								value="selected"
								checked={scope() === 'selected'}
								disabled={!hasSelection() || !hasPrimaryKey()}
								onChange={() => setScope('selected')}
							/>
							Selected rows ({selectedRowCount()})
						</label>
					</div>
				</div>

				{/* Format-specific options */}
				<Show when={format() === 'csv'}>
					<div class="export-dialog__section">
						<label class="export-dialog__label">Options</label>
						<div class="export-dialog__options">
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Delimiter</label>
								<select
									class="export-dialog__select"
									value={delimiter()}
									onChange={(e) => setDelimiter(e.currentTarget.value as CsvDelimiter)}
								>
									<For each={Object.entries(DELIMITER_LABELS)}>
										{([value, label]) => <option value={value}>{label}</option>}
									</For>
								</select>
							</div>
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Encoding</label>
								<select
									class="export-dialog__select"
									value={encoding()}
									onChange={(e) => setEncoding(e.currentTarget.value as CsvEncoding)}
								>
									<For each={Object.entries(ENCODING_LABELS)}>
										{([value, label]) => <option value={value}>{label}</option>}
									</For>
								</select>
							</div>
							<label class="export-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={includeHeaders()}
									onChange={(e) => setIncludeHeaders(e.currentTarget.checked)}
								/>
								Include column headers
							</label>
							<Show when={encoding() === 'utf-8'}>
								<label class="export-dialog__checkbox-label">
									<input
										type="checkbox"
										checked={utf8Bom()}
										onChange={(e) => setUtf8Bom(e.currentTarget.checked)}
									/>
									Include BOM (byte order mark)
								</label>
							</Show>
						</div>
					</div>
				</Show>

				<Show when={format() === 'sql'}>
					<div class="export-dialog__section">
						<label class="export-dialog__label">Options</label>
						<div class="export-dialog__options">
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Rows per INSERT</label>
								<input
									class="export-dialog__input export-dialog__input--small"
									type="number"
									min={1}
									max={10000}
									value={batchSize()}
									onInput={(e) => {
										const v = parseInt(e.currentTarget.value, 10)
										if (!Number.isNaN(v) && v > 0) setBatchSize(v)
									}}
								/>
							</div>
						</div>
					</div>
				</Show>

				<Show when={format() === 'sql_update'}>
					<div class="export-dialog__section">
						<div class="export-dialog__note">
							Uses the first column as the primary key for the WHERE clause.
						</div>
					</div>
				</Show>

				{/* Preview */}
				<div class="export-dialog__section">
					<div class="export-dialog__preview-header">
						<label class="export-dialog__label">Preview</label>
						<button
							class="export-dialog__preview-btn"
							onClick={loadPreview}
							disabled={previewLoading()}
						>
							<Eye size={12} /> {previewLoading() ? 'Loading...' : 'Load Preview'}
						</button>
					</div>
					<Show when={preview()}>
						<pre class="export-dialog__preview">{preview()}</pre>
					</Show>
					<Show when={previewLoading()}>
						<div class="export-dialog__preview export-dialog__preview--loading">
							Loading preview...
						</div>
					</Show>
				</div>

				{/* Export progress */}
				<Show when={exporting()}>
					<div class="export-dialog__progress">
						<div class="export-dialog__progress-bar">
							<div class="export-dialog__progress-bar-fill" />
						</div>
						<span class="export-dialog__progress-text">
							Exporting... {progressRows() > 0 ? `${formatNumber(progressRows())} rows` : ''}
						</span>
					</div>
				</Show>

				{/* Export result */}
				<Show when={exportResult()}>
					{(result) => (
						<div class="export-dialog__result">
							Exported {formatNumber(result().rowCount)} row{result().rowCount !== 1 ? 's' : ''}
							{result().sizeBytes > 0 ? ` (${formatFileSize(result().sizeBytes)})` : ''}
						</div>
					)}
				</Show>

				{/* Error */}
				<Show when={error()}>
					<div class="export-dialog__error">{error()}</div>
				</Show>

				{/* Info about row count */}
				<div class="export-dialog__info">
					{scope() === 'selected'
						? `${selectedRowCount()} row${selectedRowCount() !== 1 ? 's' : ''} selected`
						: `${rowCountForScope()} row${rowCountForScope() !== 1 ? 's' : ''} to export`}
				</div>

				{/* Actions */}
				<div class="export-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onClose}
					>
						Close
					</button>
					<button
						class="btn btn--primary"
						onClick={handleExport}
						disabled={exporting()}
					>
						<Download size={14} /> {exporting() ? 'Exporting...' : 'Export'}
					</button>
				</div>
			</div>
		</Dialog>
	)
}
