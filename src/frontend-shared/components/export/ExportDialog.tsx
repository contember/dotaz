import ClipboardCopy from 'lucide-solid/icons/clipboard-copy'
import Download from 'lucide-solid/icons/download'
import Eye from 'lucide-solid/icons/eye'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { CsvDelimiter, CsvEncoding, ExportFormat, ExportPreviewRequest } from '../../../shared/types/export'
import type { ColumnFilter, SortColumn } from '../../../shared/types/grid'
import { getCapabilities } from '../../lib/capabilities'
import { formatPreview } from '../../lib/export-formatters'
import { rpc } from '../../lib/rpc'
import { transport } from '../../lib/transport'
import { gridStore } from '../../stores/grid'
import Dialog from '../common/Dialog'
import Select from '../common/Select'
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

type ExportPhase =
	| { status: 'idle' }
	| { status: 'exporting'; rows: number }
	| { status: 'done'; result: { rowCount: number; filePath?: string; sizeBytes: number } }
	| { status: 'error'; message: string }
	| { status: 'copying' }
	| { status: 'copied' }

export default function ExportDialog(props: ExportDialogProps) {
	const [options, setOptions] = createStore({
		format: 'csv' as ExportFormat,
		scope: 'all' as ExportScope,
		delimiter: ',' as CsvDelimiter,
		encoding: 'utf-8' as CsvEncoding,
		utf8Bom: false,
		includeHeaders: true,
		batchSize: 100,
	})
	const [previewData, setPreviewData] = createStore({
		rows: null as Record<string, unknown>[] | null,
		columns: [] as string[],
		loading: false,
	})
	const [phase, setPhase] = createSignal<ExportPhase>({ status: 'idle' })
	const preview = createMemo(() =>
		formatPreview(
			previewData.rows,
			previewData.columns,
			options.format,
			options.delimiter,
			options.includeHeaders,
			options.batchSize,
			props.schema,
			props.table,
		)
	)

	const caps = () => getCapabilities()
	const tab = () => gridStore.getTab(props.tabId)

	const hasSelection = () => {
		const snapshot = gridStore.getSelectionSnapshot(props.tabId)
		return !!snapshot && snapshot.rowCount > 0 && snapshot.columns.length > 0
	}

	const hasPrimaryKey = () => {
		const t = tab()
		if (!t) return false
		return t.columns.some((c) => c.isPrimaryKey)
	}

	const selectedRowCount = () => {
		return gridStore.getSelectionSnapshot(props.tabId)?.rowCount ?? 0
	}

	const selectedCellCount = () => {
		return gridStore.getSelectionSnapshot(props.tabId)?.cellCount ?? 0
	}

	const selectedColumnNames = () => {
		return gridStore
			.getSelectionSnapshot(props.tabId)
			?.columns.map((column) => column.name)
	}

	const rowCountForScope = () => {
		const t = tab()
		if (!t) return 0
		if (options.scope === 'selected') return selectedRowCount()
		if (options.scope === 'view' && t.filters.length > 0) return t.totalCount
		return t.totalCount
	}

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			setOptions(reconcile({
				format: 'csv' as ExportFormat,
				scope: (props.initialScope ?? 'all') as ExportScope,
				delimiter: ',' as CsvDelimiter,
				encoding: 'utf-8' as CsvEncoding,
				utf8Bom: false,
				includeHeaders: true,
				batchSize: 100,
			}))
			setPreviewData(reconcile({ rows: null, columns: [], loading: false }))
			setPhase({ status: 'idle' })
		}
	})

	function getExportFilters(): ColumnFilter[] | undefined {
		const t = tab()
		if (!t) return undefined

		if (options.scope === 'all') return undefined
		if (options.scope === 'view') {
			return t.filters.length > 0 ? t.filters : undefined
		}

		// Selected rows: construct IN filter from PK values
		if (options.scope === 'selected') {
			const selectedColumns = selectedColumnNames()
			if (!selectedColumns || selectedColumns.length === 0) return undefined

			const pkCols = t.columns.filter((c) => c.isPrimaryKey)
			if (pkCols.length === 0) return undefined

			const selectedIndices = gridStore.getSelectionSnapshot(props.tabId)?.rowIndices ?? []
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
		if (options.scope === 'all') return undefined
		if (options.scope === 'view') {
			return t.sort.length > 0 ? t.sort : undefined
		}
		return undefined
	}

	async function loadPreview() {
		setPreviewData({ rows: null, columns: [], loading: true })
		setPhase({ status: 'idle' })

		try {
			const result = await rpc.export.previewRows({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				limit: 10,
				columns: options.scope === 'selected' ? selectedColumnNames() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			})
			setPreviewData({ rows: result.rows, columns: result.columns, loading: false })
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
			setPreviewData('loading', false)
		}
	}

	async function handleExport() {
		setPhase({ status: 'idle' })

		const ext = FILE_EXTENSIONS[options.format]
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
					filters: [{ name: FORMAT_LABELS[options.format], extensions: [ext] }],
				})

				if (saveResult.cancelled || !saveResult.path) return
				exportFilePath = saveResult.path
			} catch (err) {
				setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
				return
			}
		}

		setPhase({ status: 'exporting', rows: 0 })

		// Subscribe to progress events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'export.progress',
			(payload) => setPhase({ status: 'exporting', rows: payload.rowCount }),
		)

		try {
			const result = await rpc.export.exportData({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: options.format,
				filePath: exportFilePath ?? defaultName,
				columns: options.scope === 'selected' ? selectedColumnNames() : undefined,
				delimiter: options.format === 'csv' ? options.delimiter : undefined,
				encoding: options.format === 'csv' ? options.encoding : undefined,
				utf8Bom: options.format === 'csv' && options.encoding === 'utf-8' ? options.utf8Bom : undefined,
				includeHeaders: options.format === 'csv' ? options.includeHeaders : undefined,
				batchSize: options.format === 'sql' ? options.batchSize : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			})

			setPhase({ status: 'done', result })
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
		} finally {
			unsub()
		}
	}

	async function handleWebExport(defaultName: string) {
		setPhase({ status: 'exporting', rows: 0 })

		// Subscribe to progress and completion events
		const unsub = transport.addMessageListener<{ rowCount: number }>(
			'export.progress',
			(payload) => setPhase({ status: 'exporting', rows: payload.rowCount }),
		)

		let completionReceived = false
		const unsubComplete = transport.addMessageListener<{ rowCount: number }>(
			'export.complete',
			(payload) => {
				completionReceived = true
				setPhase({ status: 'done', result: { rowCount: payload.rowCount, sizeBytes: 0 } })
			},
		)

		try {
			// Get a stream token via WS RPC
			const { token } = await transport.call<{ token: string }>(
				'stream.createExportToken',
				{
					connectionId: props.connectionId,
					database: props.database,
					schema: props.schema,
					table: props.table,
					format: options.format,
					columns: options.scope === 'selected' ? selectedColumnNames() : undefined,
					delimiter: options.format === 'csv' ? options.delimiter : undefined,
					encoding: options.format === 'csv' ? options.encoding : undefined,
					utf8Bom: options.format === 'csv' && options.encoding === 'utf-8'
						? options.utf8Bom
						: undefined,
					includeHeaders: options.format === 'csv' ? options.includeHeaders : undefined,
					batchSize: options.format === 'sql' ? options.batchSize : undefined,
					filters: getExportFilters(),
					sort: getExportSort(),
				},
			)

			// Trigger browser download via hidden anchor tag
			const a = document.createElement('a')
			a.href = `/api/stream/export/${token}`
			a.download = defaultName
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)

			// Wait for completion signal with a timeout
			await new Promise<void>((resolve) => {
				// For anchor-based downloads, we can't detect stream end precisely.
				// Show the download as started after a brief delay if no completion yet.
				setTimeout(() => {
					if (!completionReceived && phase().status === 'exporting') {
						const p = phase()
						setPhase({ status: 'done', result: { rowCount: p.status === 'exporting' ? p.rows : 0, sizeBytes: 0 } })
					}
					resolve()
				}, 3000)
			})
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
		} finally {
			// Clean up listeners after a delay to catch late messages
			setTimeout(() => {
				unsub()
				unsubComplete()
			}, 5000)
		}
	}

	async function handleCopyToClipboard() {
		setPhase({ status: 'copying' })

		try {
			const params: ExportPreviewRequest = {
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: options.format,
				limit: Number.MAX_SAFE_INTEGER,
				columns: options.scope === 'selected' ? selectedColumnNames() : undefined,
				delimiter: options.format === 'csv' ? options.delimiter : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			}

			const result = await rpc.export.preview(params)
			await navigator.clipboard.writeText(result.content)
			setPhase({ status: 'copied' })
			setTimeout(() => setPhase({ status: 'idle' }), 2000)
		} catch (err) {
			setPhase({ status: 'error', message: err instanceof Error ? err.message : String(err) })
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

	const isExporting = () => phase().status === 'exporting'

	return (
		<Dialog
			open={props.open}
			title="Export Data"
			onClose={props.onClose}
			class="export-dialog-modal"
		>
			<div class="export-dialog">
				{/* Format selection */}
				<div class="export-dialog__section">
					<label class="export-dialog__label">Format</label>
					<div class="export-dialog__format-group">
						<For
							each={Object.entries(FORMAT_LABELS) as [ExportFormat, string][]}
						>
							{([fmt, label]) => (
								<button
									class="export-dialog__format-btn"
									classList={{
										'export-dialog__format-btn--active': options.format === fmt,
									}}
									onClick={() => setOptions('format', fmt)}
								>
									{label}
								</button>
							)}
						</For>
					</div>
				</div>

				{/* Scope + Options */}
				<div class="export-dialog__row">
					<div class="export-dialog__section">
						<label class="export-dialog__label">Scope</label>
						<div class="export-dialog__scope-group">
							<label class="export-dialog__radio-label">
								<input
									type="radio"
									name="scope"
									value="all"
									checked={options.scope === 'all'}
									onChange={() => setOptions('scope', 'all')}
								/>
								Entire table
							</label>
							<label class="export-dialog__radio-label">
								<input
									type="radio"
									name="scope"
									value="view"
									checked={options.scope === 'view'}
									onChange={() => setOptions('scope', 'view')}
								/>
								Current view
							</label>
							<label
								class="export-dialog__radio-label"
								classList={{
									'export-dialog__radio-label--disabled': !hasSelection() || !hasPrimaryKey(),
								}}
							>
								<input
									type="radio"
									name="scope"
									value="selected"
									checked={options.scope === 'selected'}
									disabled={!hasSelection() || !hasPrimaryKey()}
									onChange={() => setOptions('scope', 'selected')}
								/>
								Selected ({selectedRowCount()})
							</label>
						</div>
					</div>

					<Show when={options.format === 'csv'}>
						<div class="export-dialog__section">
							<label class="export-dialog__label">Options</label>
							<div class="export-dialog__options">
								<div class="export-dialog__field">
									<label class="export-dialog__field-label">Delimiter</label>
									<Select
										class="export-dialog__select"
										value={options.delimiter}
										onChange={(v) => setOptions('delimiter', v as CsvDelimiter)}
										options={Object.entries(DELIMITER_LABELS).map(
											([value, label]) => ({ value, label }),
										)}
									/>
								</div>
								<div class="export-dialog__field">
									<label class="export-dialog__field-label">Encoding</label>
									<Select
										class="export-dialog__select"
										value={options.encoding}
										onChange={(v) => setOptions('encoding', v as CsvEncoding)}
										options={Object.entries(ENCODING_LABELS).map(
											([value, label]) => ({ value, label }),
										)}
									/>
								</div>
								<div class="export-dialog__field">
									<div class="export-dialog__field-label" />
									<label class="export-dialog__checkbox-label">
										<input
											type="checkbox"
											checked={options.includeHeaders}
											onChange={(e) => setOptions('includeHeaders', e.currentTarget.checked)}
										/>
										Include headers
									</label>
								</div>
								<Show when={options.encoding === 'utf-8'}>
									<div class="export-dialog__field">
										<div class="export-dialog__field-label" />
										<label class="export-dialog__checkbox-label">
											<input
												type="checkbox"
												checked={options.utf8Bom}
												onChange={(e) => setOptions('utf8Bom', e.currentTarget.checked)}
											/>
											Include BOM
										</label>
									</div>
								</Show>
							</div>
						</div>
					</Show>

					<Show when={options.format === 'sql'}>
						<div class="export-dialog__section">
							<label class="export-dialog__label">Options</label>
							<div class="export-dialog__options">
								<div class="export-dialog__field">
									<label class="export-dialog__field-label">
										Rows per INSERT
									</label>
									<input
										class="export-dialog__input export-dialog__input--small"
										type="number"
										min={1}
										max={10000}
										value={options.batchSize}
										onInput={(e) => {
											const v = parseInt(e.currentTarget.value, 10)
											if (!Number.isNaN(v) && v > 0) setOptions('batchSize', v)
										}}
									/>
								</div>
							</div>
						</div>
					</Show>

					<Show when={options.format === 'sql_update'}>
						<div class="export-dialog__section">
							<label class="export-dialog__label">Options</label>
							<p class="export-dialog__note">
								First column used as the primary key in the WHERE clause.
							</p>
						</div>
					</Show>
				</div>

				{/* Preview */}
				<div class="export-dialog__section">
					<div class="export-dialog__preview-header">
						<label class="export-dialog__label">Preview</label>
						<button
							class="export-dialog__preview-btn"
							onClick={loadPreview}
							disabled={previewData.loading}
						>
							<Eye size={12} /> {previewData.loading ? 'Loading...' : 'Load Preview'}
						</button>
					</div>
					<Show when={previewData.loading}>
						<div class="export-dialog__preview export-dialog__preview--loading">
							Loading preview...
						</div>
					</Show>
					<Show when={!previewData.loading && !!preview()}>
						<pre class="export-dialog__preview">{preview()}</pre>
					</Show>
					<Show when={!previewData.loading && previewData.rows === null}>
						<div class="export-dialog__preview--empty">
							Click "Load Preview" to see a sample of the exported data
						</div>
					</Show>
				</div>

				{/* Export progress */}
				<Show when={phase().status === 'exporting'}>
					<div class="export-dialog__progress">
						<div class="export-dialog__progress-bar">
							<div class="export-dialog__progress-bar-fill" />
						</div>
						<span class="export-dialog__progress-text">
							Exporting... {(() => {
								const p = phase()
								return p.status === 'exporting' && p.rows > 0 ? `${formatNumber(p.rows)} rows` : ''
							})()}
						</span>
					</div>
				</Show>

				{/* Export result */}
				<Show when={phase().status === 'done'}>
					{(_) => {
						const p = phase() as Extract<ExportPhase, { status: 'done' }>
						return (
							<div class="export-dialog__result">
								Exported {formatNumber(p.result.rowCount)} row
								{p.result.rowCount !== 1 ? 's' : ''}
								{p.result.sizeBytes > 0
									? ` (${formatFileSize(p.result.sizeBytes)})`
									: ''}
							</div>
						)
					}}
				</Show>

				{/* Error */}
				<Show when={phase().status === 'error'}>
					<div class="export-dialog__error">{(phase() as Extract<ExportPhase, { status: 'error' }>).message}</div>
				</Show>

				{/* Info about row count */}
				<div class="export-dialog__info">
					{options.scope === 'selected'
						? `${selectedRowCount()} row${selectedRowCount() !== 1 ? 's' : ''}, ${selectedCellCount()} cell${selectedCellCount() !== 1 ? 's' : ''} selected`
						: `${rowCountForScope() ?? 0} row${(rowCountForScope() ?? 0) !== 1 ? 's' : ''} to export`}
				</div>

				{/* Actions */}
				<div class="export-dialog__actions">
					<button class="btn btn--secondary" onClick={props.onClose}>
						Close
					</button>
					<button
						class="btn btn--secondary"
						onClick={handleCopyToClipboard}
						disabled={phase().status === 'copying' || isExporting()}
					>
						<ClipboardCopy size={14} /> {phase().status === 'copying'
							? 'Copying...'
							: phase().status === 'copied'
							? 'Copied!'
							: 'Copy to Clipboard'}
					</button>
					<button
						class="btn btn--primary"
						onClick={handleExport}
						disabled={isExporting()}
					>
						<Download size={14} /> {isExporting() ? 'Exporting...' : 'Export'}
					</button>
				</div>
			</div>
		</Dialog>
	)
}
