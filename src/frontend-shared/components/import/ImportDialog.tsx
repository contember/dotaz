import AlertTriangle from 'lucide-solid/icons/alert-triangle'
import Eye from 'lucide-solid/icons/eye'
import Upload from 'lucide-solid/icons/upload'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { ColumnInfo } from '@dotaz/shared/types/database'
import type { ColumnMapping, CsvDelimiter, ImportFormat, ImportPreviewResult } from '@dotaz/shared/types/import'
import { getCapabilities } from '../../lib/capabilities'
import { rpc } from '../../lib/rpc'
import { transport } from '../../lib/transport'
import { formatDisplayValue, formatNumber } from '../../lib/value-format'
import Dialog from '../common/Dialog'
import Select from '../common/Select'
import './ImportDialog.css'

interface ImportDialogProps {
	open: boolean
	connectionId: string
	schema: string
	table: string
	database?: string
	onClose: () => void
	onImported?: () => void
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
	csv: 'CSV',
	json: 'JSON',
}

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
	',': 'Comma (,)',
	';': 'Semicolon (;)',
	'\t': 'Tab',
}

const FILE_ACCEPT: Record<ImportFormat, string> = {
	csv: '.csv,.tsv,.txt',
	json: '.json',
}

type ImportPhase =
	| { status: 'idle' }
	| { status: 'importing'; rows: number }
	| { status: 'done'; result: { rowCount: number } }
	| { status: 'error'; message: string }

export default function ImportDialog(props: ImportDialogProps) {
	let fileInputRef: HTMLInputElement | undefined

	const [file, setFile] = createStore({
		content: null as string | null,
		path: null as string | null,
		name: null as string | null,
		file: null as File | null,
	})
	const [importOptions, setImportOptions] = createStore({
		format: 'csv' as ImportFormat,
		delimiter: ',' as CsvDelimiter,
		hasHeader: true,
	})
	const [phase, setPhase] = createSignal<ImportPhase>({ status: 'idle' })
	const [preview, setPreview] = createSignal<ImportPreviewResult | null>(null)
	const [previewLoading, setPreviewLoading] = createSignal(false)
	const [mappings, setMappings] = createSignal<ColumnMapping[]>([])
	const [tableColumns, setTableColumns] = createSignal<ColumnInfo[]>([])

	const caps = () => getCapabilities()

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			setImportOptions(reconcile({ format: 'csv' as ImportFormat, delimiter: ',' as CsvDelimiter, hasHeader: true }))
			setFile(reconcile({ content: null, path: null, name: null, file: null }))
			setPreview(null)
			setPreviewLoading(false)
			setMappings([])
			setTableColumns([])
			setPhase({ status: 'idle' })
			if (fileInputRef) fileInputRef.value = ''
			loadTableColumns()
		}
	})

	async function loadTableColumns() {
		try {
			const schema = await rpc.schema.load({
				connectionId: props.connectionId,
				database: props.database,
			})
			const columns = schema.columns[`${props.schema}.${props.table}`] ?? []
			setTableColumns(columns)
		} catch {
			// Ignore schema load errors
		}
	}

	async function handleBrowseClick() {
		if (caps().hasFileSystem && caps().hasNativeDialogs) {
			// Desktop: use native file dialog -> store file path (not content)
			try {
				const exts = FILE_ACCEPT[importOptions.format].split(',').map(s => s.replace('.', ''))
				const result = await rpc.system.showOpenDialog({
					filters: [{ name: FORMAT_LABELS[importOptions.format], extensions: exts }],
					multiple: false,
				})
				if (result.cancelled || result.paths.length === 0) return
				const path = result.paths[0]
				setFile({ path, name: path.split('/').pop() ?? path, content: null })
				setPhase({ status: 'idle' })
				await loadPreview()
			} catch (err) {
				setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
			}
		} else {
			// Demo/Web: use browser file input
			if (fileInputRef) {
				fileInputRef.accept = FILE_ACCEPT[importOptions.format]
				fileInputRef.click()
			}
		}
	}

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const f = input.files?.[0]
		if (!f) return

		setFile({ name: f.name, path: null, file: f })
		setPhase({ status: 'idle' })

		try {
			if (caps().hasHttpStreaming) {
				// Web mode: store File object for HTTP upload, read 64KB prefix for preview
				const prefix = await f.slice(0, 65536).text()
				setFile('content', prefix)
				await loadPreview(prefix)
			} else {
				// Demo mode: read entire file content via WS
				const content = await f.text()
				setFile('content', content)
				await loadPreview(content)
			}
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}

	async function loadPreview(content?: string) {
		const fp = file.path
		const fc = content ?? file.content
		if (!fp && !fc) return

		setPreviewLoading(true)
		setPreview(null)
		setPhase({ status: 'idle' })

		try {
			const result = await rpc.import.preview({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				database: props.database,
				...(fp ? { filePath: fp } : { fileContent: fc! }),
				format: importOptions.format,
				delimiter: importOptions.format === 'csv' ? importOptions.delimiter : undefined,
				hasHeader: importOptions.format === 'csv' ? importOptions.hasHeader : undefined,
				limit: 20,
			})

			setPreview(result)
			autoMapColumns(result.fileColumns)
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
		} finally {
			setPreviewLoading(false)
		}
	}

	function autoMapColumns(fileColumns: string[]) {
		const tCols = tableColumns()
		const tColNames = new Set(tCols.map((c) => c.name))
		const tColNamesLower = new Map(tCols.map((c) => [c.name.toLowerCase(), c.name]))

		const newMappings: ColumnMapping[] = fileColumns.map((fc) => {
			if (tColNames.has(fc)) {
				return { fileColumn: fc, tableColumn: fc }
			}
			const match = tColNamesLower.get(fc.toLowerCase())
			if (match) {
				return { fileColumn: fc, tableColumn: match }
			}
			return { fileColumn: fc, tableColumn: null }
		})

		setMappings(newMappings)
	}

	function updateMapping(index: number, tableColumn: string | null) {
		setMappings((prev) => {
			const next = [...prev]
			next[index] = { ...next[index], tableColumn }
			return next
		})
	}

	function activeMappingCount() {
		return mappings().filter((m) => m.tableColumn !== null).length
	}

	async function handleImport() {
		const fp = file.path
		const fc = file.content
		const sf = file.file
		if (!fp && !fc && !sf) return

		// Web mode: use HTTP streaming
		if (caps().hasHttpStreaming && sf) {
			return handleWebImport(sf)
		}

		setPhase({ status: 'importing', rows: 0 })

		// Subscribe to progress events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'import.progress',
			(payload) => setPhase({ status: 'importing', rows: payload.rowCount }),
		)

		try {
			const result = await rpc.import.importData({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				database: props.database,
				...(fp ? { filePath: fp } : { fileContent: fc! }),
				format: importOptions.format,
				delimiter: importOptions.format === 'csv' ? importOptions.delimiter : undefined,
				hasHeader: importOptions.format === 'csv' ? importOptions.hasHeader : undefined,
				mappings: mappings(),
			})

			setPhase({ status: 'done', result })
			props.onImported?.()
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
		} finally {
			unsub()
		}
	}

	async function handleWebImport(f: File) {
		setPhase({ status: 'importing', rows: 0 })

		// Subscribe to progress events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'import.progress',
			(payload) => setPhase({ status: 'importing', rows: payload.rowCount }),
		)

		const abortController = new AbortController()

		try {
			// Get a stream token via WS
			const { token } = await transport.call<{ token: string }>('stream.createImportToken', {
				connectionId: props.connectionId,
				database: props.database,
				schema: props.schema,
				table: props.table,
				format: importOptions.format,
				delimiter: importOptions.format === 'csv' ? importOptions.delimiter : undefined,
				hasHeader: importOptions.format === 'csv' ? importOptions.hasHeader : undefined,
				mappings: mappings(),
			})

			// POST the file to the HTTP endpoint
			const response = await fetch(`/api/stream/import/${token}`, {
				method: 'POST',
				body: f,
				signal: abortController.signal,
			})

			const result = await response.json()
			if (!response.ok) {
				throw new Error(result.error ?? 'Import failed')
			}

			setPhase({ status: 'done', result: { rowCount: result.rowCount } })
			props.onImported?.()
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				setPhase({ status: 'error', message: 'Import cancelled' })
			} else {
				setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
			}
		} finally {
			unsub()
		}
	}

	const hasFile = () => file.path !== null || file.content !== null || file.file !== null

	const canImport = () =>
		hasFile()
		&& activeMappingCount() > 0
		&& phase().status !== 'importing'
		&& phase().status !== 'done'

	/** Whether preview was from a 64KB prefix (streaming mode without totalRows) */
	const isPartialPreview = () => {
		const p = preview()
		return p !== null && p.totalRows === undefined && p.rows.length >= 20
	}

	return (
		<Dialog
			open={props.open}
			title="Import Data"
			onClose={props.onClose}
		>
			<div class="import-dialog">
				{/* Hidden file input (for demo/web mode) */}
				<Show when={!caps().hasNativeDialogs}>
					<input
						ref={fileInputRef}
						type="file"
						style={{ display: 'none' }}
						accept={FILE_ACCEPT[importOptions.format]}
						onChange={handleFileChange}
					/>
				</Show>

				{/* Format selection */}
				<div class="import-dialog__section">
					<label class="import-dialog__label">Format</label>
					<div class="import-dialog__format-group">
						<For each={Object.entries(FORMAT_LABELS) as [ImportFormat, string][]}>
							{([fmt, label]) => (
								<button
									class="import-dialog__format-btn"
									classList={{ 'import-dialog__format-btn--active': importOptions.format === fmt }}
									onClick={() => {
										setImportOptions('format', fmt)
										setFile(reconcile({ content: null, path: null, name: null, file: null }))
										setPreview(null)
										setMappings([])
										setPhase({ status: 'idle' })
										if (fileInputRef) fileInputRef.value = ''
									}}
								>
									{label}
								</button>
							)}
						</For>
					</div>
				</div>

				{/* File selection */}
				<div class="import-dialog__section">
					<label class="import-dialog__label">File</label>
					<div class="import-dialog__file-row">
						<div
							class="import-dialog__file-name"
							classList={{ 'import-dialog__file-name--empty': !file.name }}
						>
							{file.name ?? 'No file selected'}
						</div>
						<button
							class="import-dialog__browse-btn"
							onClick={handleBrowseClick}
							disabled={phase().status === 'importing'}
						>
							Browse...
						</button>
					</div>
				</div>

				{/* CSV options */}
				<Show when={importOptions.format === 'csv'}>
					<div class="import-dialog__section">
						<label class="import-dialog__label">Options</label>
						<div class="import-dialog__options">
							<div class="import-dialog__field">
								<label class="import-dialog__field-label">Delimiter</label>
								<Select
									class="import-dialog__select"
									value={importOptions.delimiter}
									onChange={(v) => {
										setImportOptions('delimiter', v as CsvDelimiter)
										if (hasFile()) loadPreview()
									}}
									options={Object.entries(DELIMITER_LABELS).map(([value, label]) => ({ value, label }))}
								/>
							</div>
							<label class="import-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={importOptions.hasHeader}
									onChange={(e) => {
										setImportOptions('hasHeader', e.currentTarget.checked)
										if (hasFile()) loadPreview()
									}}
								/>
								First row is header
							</label>
						</div>
					</div>
				</Show>

				{/* Column mapping */}
				<Show when={preview() && mappings().length > 0}>
					<div class="import-dialog__section">
						<label class="import-dialog__label">
							Column Mapping ({activeMappingCount()} of {mappings().length} mapped)
						</label>
						<div class="import-dialog__mapping">
							<div class="import-dialog__mapping-header">
								<span>File Column</span>
								<span />
								<span>Table Column</span>
							</div>
							<For each={mappings()}>
								{(mapping, index) => (
									<div class="import-dialog__mapping-row">
										<div class="import-dialog__mapping-file-col">
											{mapping.fileColumn}
										</div>
										<div class="import-dialog__mapping-arrow">&rarr;</div>
										<Select
											class="import-dialog__mapping-select"
											value={mapping.tableColumn ?? ''}
											onChange={(v) => {
												updateMapping(index(), v === '' ? null : v)
											}}
											options={[{ value: '', label: '(skip)' }, ...tableColumns().map((col) => ({ value: col.name, label: col.name }))]}
										/>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Data preview */}
				<Show when={preview()}>
					{(p) => (
						<div class="import-dialog__section">
							<div class="import-dialog__preview-header">
								<label class="import-dialog__label">
									Preview (first {Math.min(p().rows.length, 20)}
									{p().totalRows !== undefined ? ` of ${formatNumber(p().totalRows!)}` : ''} rows)
								</label>
								<button
									class="import-dialog__browse-btn"
									onClick={() => loadPreview()}
									disabled={previewLoading() || !hasFile()}
								>
									<Eye size={12} /> Reload
								</button>
							</div>
							<div class="import-dialog__preview">
								<table>
									<thead>
										<tr>
											<For each={p().fileColumns}>
												{(col) => <th>{col}</th>}
											</For>
										</tr>
									</thead>
									<tbody>
										<For each={p().rows.slice(0, 10)}>
											{(row) => (
												<tr>
													<For each={p().fileColumns}>
														{(col) => (
															<td>
																<Show
																	when={row[col] !== null && row[col] !== undefined}
																	fallback={<span class="import-dialog__preview-null">NULL</span>}
																>
																	{formatDisplayValue(row[col])}
																</Show>
															</td>
														)}
													</For>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
					)}
				</Show>

				<Show when={previewLoading()}>
					<div class="import-dialog__preview--loading">
						Loading preview...
					</div>
				</Show>

				{/* Partial preview warning */}
				<Show when={isPartialPreview()}>
					<div class="import-dialog__warning">
						<AlertTriangle size={14} /> Preview based on first 64KB of file. Actual row count may differ.
					</div>
				</Show>

				{/* Import progress */}
				<Show when={phase().status === 'importing'}>
					<div class="import-dialog__progress">
						<div class="import-dialog__progress-bar">
							<div class="import-dialog__progress-bar-fill" />
						</div>
						<span class="import-dialog__progress-text">
							Importing... {(phase() as Extract<ImportPhase, { status: 'importing' }>).rows > 0
								? `${formatNumber((phase() as Extract<ImportPhase, { status: 'importing' }>).rows)} rows`
								: ''}
						</span>
					</div>
				</Show>

				{/* Import result */}
				<Show when={phase().status === 'done' ? (phase() as Extract<ImportPhase, { status: 'done' }>).result : undefined}>
					{(result) => (
						<div class="import-dialog__result">
							Successfully imported {formatNumber(result().rowCount)} row{result().rowCount !== 1 ? 's' : ''}
						</div>
					)}
				</Show>

				{/* Error */}
				<Show when={phase().status === 'error' ? (phase() as Extract<ImportPhase, { status: 'error' }>).message : undefined}>
					<div class="import-dialog__error">{(phase() as Extract<ImportPhase, { status: 'error' }>).message}</div>
				</Show>

				{/* Info */}
				<Show when={preview() && phase().status !== 'done'}>
					<div class="import-dialog__info">
						{preview()!.totalRows !== undefined
							? `${formatNumber(preview()!.totalRows!)} row${preview()!.totalRows !== 1 ? 's' : ''}`
							: `${preview()!.rows.length}+ rows`} to import
						{activeMappingCount() > 0
							? ` into ${activeMappingCount()} column${activeMappingCount() !== 1 ? 's' : ''}`
							: ' (no columns mapped)'}
					</div>
				</Show>

				{/* Actions */}
				<div class="import-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onClose}
					>
						{phase().status === 'done' ? 'Close' : 'Cancel'}
					</button>
					<Show when={phase().status !== 'done'}>
						<button
							class="btn btn--primary"
							onClick={handleImport}
							disabled={!canImport()}
						>
							<Upload size={14} /> {phase().status === 'importing' ? 'Importing...' : 'Import'}
						</button>
					</Show>
				</div>
			</div>
		</Dialog>
	)
}
