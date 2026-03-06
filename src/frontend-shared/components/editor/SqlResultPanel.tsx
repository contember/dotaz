import Check from 'lucide-solid/icons/check'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import Code from 'lucide-solid/icons/code'
import Lock from 'lucide-solid/icons/lock'
import Pencil from 'lucide-solid/icons/pencil'
import Pin from 'lucide-solid/icons/pin'
import PinOff from 'lucide-solid/icons/pin-off'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import TriangleAlert from 'lucide-solid/icons/triangle-alert'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { GridColumnDef } from '../../../shared/types/grid'
import type { QueryEditability, QueryResult, QueryResultColumn } from '../../../shared/types/query'
import { connectionsStore } from '../../stores/connections'
import { editorStore, type PinnedResultSet } from '../../stores/editor'
import type { ColumnConfig } from '../../stores/grid'
import { settingsStore } from '../../stores/settings'
import Icon from '../common/Icon'
import Select from '../common/Select'
import GridHeader from '../grid/GridHeader'
import VirtualScroller from '../grid/VirtualScroller'
import ExplainPanel from './ExplainPanel'
import './SqlResultPanel.css'

interface SqlResultPanelProps {
	tabId: string
	connectionId: string
}

const HEADER_HEIGHT = 34
const EMPTY_SORT: [] = []
const EMPTY_PIN_STYLES = new Map<string, Record<string, string>>()
const EMPTY_FK_COLUMNS = new Set<string>()
const noop = () => {}

function toGridColumn(col: QueryResultColumn, editability?: QueryEditability): GridColumnDef {
	return {
		name: col.name,
		dataType: col.dataType,
		nullable: false,
		isPrimaryKey: editability?.primaryKeys?.includes(col.name) ?? false,
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms} ms`
	return `${(ms / 1000).toFixed(1)} s`
}

function getResultLabel(result: QueryResult, index: number): string {
	if (result.error) return `Error`
	if (result.columns.length > 0) return `Result ${index + 1}`
	return `Statement ${index + 1}`
}

function getReadOnlyReason(editability: QueryEditability): string {
	switch (editability.reason) {
		case 'not_select':
			return 'Not a SELECT query'
		case 'aggregation':
			return 'Aggregation query (GROUP BY / aggregate functions)'
		case 'union':
			return 'UNION / INTERSECT / EXCEPT query'
		case 'subquery':
			return 'Contains subqueries'
		case 'multi_table':
			return 'Multi-table query (JOIN / multiple tables)'
		case 'no_pk':
			return 'Primary key columns not in result set'
		case 'unknown_table':
			return 'Could not identify source table'
		default:
			return 'Read-only result'
	}
}

export default function SqlResultPanel(props: SqlResultPanelProps) {
	const [activeResultIndex, setActiveResultIndex] = createSignal(0)
	const [minimized, setMinimized] = createSignal(false)

	const tab = () => editorStore.getTab(props.tabId)
	const pinnedResults = () => tab()?.pinnedResults ?? []
	const activeResultView = () => tab()?.activeResultView ?? null
	const hasPinnedTabs = () => pinnedResults().length > 0

	// Current (unpinned) result data
	const currentResults = () => tab()?.results ?? []
	const currentError = () => tab()?.error ?? null
	const currentDuration = () => tab()?.duration ?? 0
	const currentExplain = () => tab()?.explainResult ?? null
	const currentHasContent = () => currentResults().length > 0 || currentError() !== null || currentExplain() !== null

	// The viewed result set — either pinned or current
	const viewedPinned = (): PinnedResultSet | undefined => {
		const view = activeResultView()
		if (!view) return undefined
		return pinnedResults().find((p) => p.id === view)
	}

	const isViewingPinned = () => activeResultView() !== null && viewedPinned() !== undefined

	const results = () => {
		const pinned = viewedPinned()
		return pinned ? pinned.results : currentResults()
	}
	const error = () => {
		const pinned = viewedPinned()
		return pinned ? pinned.error : currentError()
	}
	const duration = () => {
		const pinned = viewedPinned()
		return pinned ? pinned.duration : currentDuration()
	}
	const explainResult = () => {
		const pinned = viewedPinned()
		return pinned ? pinned.explainResult : currentExplain()
	}
	const isRunning = () => tab()?.isRunning ?? false

	// Truncation state for the active result
	const isActiveResultTruncated = () => {
		const idx = activeResultIndex()
		const pinned = viewedPinned()
		if (pinned) return pinned.truncated[idx] ?? false
		return tab()?.resultTruncated[idx] ?? false
	}

	const LIMIT_OPTIONS = [100, 500, 1000, 5000, 0] as const
	const currentLimit = () => settingsStore.consoleConfig.defaultResultLimit

	function handleLimitChange(v: string) {
		const value = Number(v)
		settingsStore.saveConsoleConfig({ ...settingsStore.consoleConfig, defaultResultLimit: value })
	}

	createEffect(() => {
		results()
		setActiveResultIndex(0)
	})

	const activeResult = () => {
		const r = results()
		const idx = activeResultIndex()
		return idx < r.length ? r[idx] : undefined
	}

	// Editability for the active result
	const activeEditability = (): QueryEditability | undefined => {
		if (isViewingPinned()) return undefined // Pinned results are not editable
		const t = tab()
		if (!t) return undefined
		return t.resultEditability[activeResultIndex()]
	}

	const isReadOnly = () => connectionsStore.isReadOnly(props.connectionId)

	const hasContent = () => results().length > 0 || error() !== null || explainResult() !== null
	const anyContent = () => hasContent() || currentHasContent() || hasPinnedTabs()

	return (
		<div
			class="sql-result-panel"
			classList={{ 'sql-result-panel--minimized': minimized() }}
		>
			<Show when={anyContent() || isRunning()}>
				<div class="sql-result-panel__header">
					<div class="sql-result-panel__header-left">
						{/* Pinned result set tabs */}
						<Show when={hasPinnedTabs()}>
							<For each={pinnedResults()}>
								{(pinned, idx) => (
									<div
										class="sql-result-panel__result-tab"
										classList={{
											'sql-result-panel__result-tab--active': activeResultView() === pinned.id,
											'sql-result-panel__result-tab--pinned': true,
										}}
										onClick={() => editorStore.setActiveResultView(props.tabId, pinned.id)}
										title={`Pinned result ${idx() + 1}`}
									>
										<Pin size={10} />
										<span>Result {idx() + 1}</span>
										<button
											class="sql-result-panel__result-tab-close"
											onClick={(e) => {
												e.stopPropagation()
												editorStore.unpinResult(props.tabId, pinned.id)
											}}
											title="Unpin and close"
										>
											<X size={10} />
										</button>
									</div>
								)}
							</For>
							<button
								class="sql-result-panel__result-tab"
								classList={{
									'sql-result-panel__result-tab--active': activeResultView() === null,
								}}
								onClick={() => editorStore.setActiveResultView(props.tabId, null)}
								title="Current results"
							>
								<span>Current</span>
							</button>
						</Show>

						{/* Sub-tabs for multiple results within the active result set */}
						<Show when={!hasPinnedTabs() && explainResult()}>
							<span class="sql-result-panel__meta" style={{ 'font-weight': '600', color: 'var(--ink)' }}>
								Explain Plan
							</span>
						</Show>
						<Show when={!hasPinnedTabs() && !explainResult() && results().length > 1}>
							<For each={results()}>
								{(result, idx) => (
									<button
										class="sql-result-panel__tab"
										classList={{
											'sql-result-panel__tab--active': activeResultIndex() === idx(),
										}}
										onClick={() => setActiveResultIndex(idx())}
									>
										{getResultLabel(result, idx())}
									</button>
								)}
							</For>
						</Show>
					</div>

					<div class="sql-result-panel__header-right">
						<Show when={hasPinnedTabs() && explainResult()}>
							<span class="sql-result-panel__meta" style={{ 'font-weight': '600', color: 'var(--ink)' }}>
								Explain Plan
							</span>
						</Show>
						{/* Sub-tabs within pinned mode */}
						<Show when={hasPinnedTabs() && !explainResult() && results().length > 1}>
							<For each={results()}>
								{(result, idx) => (
									<button
										class="sql-result-panel__tab"
										classList={{
											'sql-result-panel__tab--active': activeResultIndex() === idx(),
										}}
										onClick={() => setActiveResultIndex(idx())}
									>
										{getResultLabel(result, idx())}
									</button>
								)}
							</For>
						</Show>

						{/* Editability indicator */}
						<Show when={activeResult() && !activeResult()!.error && activeResult()!.columns.length > 0}>
							{(_) => {
								const ed = activeEditability()
								return (
									<Show when={ed}>
										{(editability) => (
											<Show
												when={editability().editable && !isReadOnly()}
												fallback={
													<span
														class="sql-result-panel__editable-badge sql-result-panel__editable-badge--readonly"
														title={isReadOnly() ? 'Connection is read-only' : getReadOnlyReason(editability())}
													>
														<Lock size={10} /> Read-only
													</span>
												}
											>
												<span class="sql-result-panel__editable-badge sql-result-panel__editable-badge--editable">
													<Pencil size={10} /> Editable
												</span>
											</Show>
										)}
									</Show>
								)
							}}
						</Show>

						<Show
							when={activeResult()
								&& !activeResult()!.error
								&& activeResult()!.columns.length > 0}
						>
							<Show when={isActiveResultTruncated()}>
								<span class="sql-result-panel__truncated-badge">
									<TriangleAlert size={10} /> Result limited
								</span>
								<Show when={!isViewingPinned()}>
									<button
										class="sql-result-panel__fetch-all-btn"
										onClick={() => editorStore.fetchAllResults(props.tabId)}
										disabled={isRunning()}
									>
										Fetch All
									</button>
								</Show>
							</Show>
							<span class="sql-result-panel__meta">
								{activeResult()!.rowCount}
								{isActiveResultTruncated() ? '+' : ''} rows
							</span>
							<span class="sql-result-panel__meta-sep">&middot;</span>
							<span class="sql-result-panel__meta">
								{activeResult()!.columns.length} columns
							</span>
							<span class="sql-result-panel__meta-sep">&middot;</span>
						</Show>
						<Show when={hasContent()}>
							<span class="sql-result-panel__meta">
								{formatDuration(duration())}
							</span>
						</Show>
						<Select
							class="sql-result-panel__limit-select"
							value={String(currentLimit())}
							onChange={handleLimitChange}
							title="Default result limit"
							options={[...LIMIT_OPTIONS].map((opt) => ({ value: String(opt), label: opt === 0 ? 'No limit' : `Limit ${opt}` }))}
						/>
						{/* Pin button for current results */}
						<Show when={!isViewingPinned() && currentHasContent()}>
							<button
								class="sql-result-panel__pin-btn"
								onClick={() => editorStore.pinCurrentResult(props.tabId)}
								title="Pin current results"
							>
								<PinOff size={12} />
							</button>
						</Show>
						<button
							class="sql-result-panel__toggle"
							onClick={() => setMinimized((m) => !m)}
							title={minimized() ? 'Expand results' : 'Collapse results'}
						>
							{minimized() ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
						</button>
					</div>
				</div>
			</Show>

			<Show when={!minimized()}>
				<div class="sql-result-panel__content">
					<Switch>
						<Match when={!hasContent() && !isRunning()}>
							<div class="empty-state">
								<Icon name="sql-console" size={28} class="empty-state__icon" />
								<div class="empty-state__title">No results yet</div>
								<div class="empty-state__subtitle">Run a query to see results</div>
							</div>
						</Match>

						<Match when={!isViewingPinned() && isRunning()}>
							<div class="sql-result-panel__loading">
								<Icon name="spinner" size={14} />
								Running query...
							</div>
						</Match>

						<Match when={error()}>
							<div class="sql-result-panel__error">
								<div class="sql-result-panel__error-title">
									<Icon name="error" size={14} /> Error
								</div>
								<div class="sql-result-panel__error-message">{error()}</div>
							</div>
						</Match>

						<Match when={explainResult()}>
							{(result) => <ExplainPanel result={result()} />}
						</Match>

						<Match when={activeResult()}>
							{(result) => (
								<Switch>
									<Match when={result().error}>
										<div class="sql-result-panel__error">
											<div class="sql-result-panel__error-title">
												Error
												<Show when={result().errorPosition?.line != null}>
													<span class="sql-result-panel__error-position">
														{' '}at line {result().errorPosition!.line}
														<Show when={result().errorPosition!.column != null}>
															, column {result().errorPosition!.column}
														</Show>
													</span>
												</Show>
											</div>
											<div class="sql-result-panel__error-message">
												{result().error}
											</div>
										</div>
									</Match>

									<Match when={result().columns.length === 0}>
										<div class="sql-result-panel__dml">
											<span class="sql-result-panel__dml-count">
												{result().affectedRows ?? result().rowCount}
											</span>
											{' rows affected'}
										</div>
									</Match>

									<Match when={result().columns.length > 0}>
										<ResultGrid
											tabId={props.tabId}
											connectionId={props.connectionId}
											resultIndex={activeResultIndex()}
											result={result()}
											editability={activeEditability()}
										/>
									</Match>
								</Switch>
							)}
						</Match>
					</Switch>
				</div>
			</Show>
		</div>
	)
}

// ── ResultGrid with editing support ───────────────────────

interface ResultGridProps {
	tabId: string
	connectionId: string
	resultIndex: number
	result: QueryResult
	editability?: QueryEditability
}

function ResultGrid(props: ResultGridProps) {
	const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
	const [columnWidths, setColumnWidths] = createSignal<Record<string, number>>({})
	const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set())
	const [showPendingPanel, setShowPendingPanel] = createSignal(false)
	const [applying, setApplying] = createSignal(false)
	const [applyError, setApplyError] = createSignal<string | null>(null)
	const [previewSql, setPreviewSql] = createSignal<string | null>(null)

	const tab = () => editorStore.getTab(props.tabId)
	const isEditable = () => {
		const e = props.editability
		return e?.editable === true && !connectionsStore.isReadOnly(props.connectionId)
	}

	const editableColumnSet = (): Set<string> => {
		if (!isEditable()) return new Set()
		return new Set(props.editability!.editableColumns ?? [])
	}

	const columns = () => props.result.columns.map((col) => toGridColumn(col, props.editability))

	// Use mutable rows from editor store when editable, original otherwise
	const rows = (): Record<string, unknown>[] => {
		if (isEditable()) {
			const t = tab()
			return t?.resultRows[props.resultIndex] ?? props.result.rows
		}
		return props.result.rows
	}

	const editingCell = () => {
		const t = tab()
		if (!t || t.resultEditingIndex !== props.resultIndex) return null
		return t.resultEditingCell
	}

	const hasPending = () => editorStore.hasResultPendingChanges(props.tabId, props.resultIndex)
	const pendingCount = () => editorStore.resultPendingChangesCount(props.tabId, props.resultIndex)

	const columnConfig = (): Record<string, ColumnConfig> => {
		const widths = columnWidths()
		const config: Record<string, ColumnConfig> = {}
		for (const [name, width] of Object.entries(widths)) {
			config[name] = { visible: true, width }
		}
		return config
	}

	function handleResizeColumn(column: string, width: number) {
		setColumnWidths((prev) => ({ ...prev, [column]: width }))
	}

	function handleRowClick(index: number, _e: MouseEvent) {
		const next = new Set<number>()
		next.add(index)
		setSelectedRows(next)
	}

	function handleRowDblClick(index: number, e: MouseEvent) {
		if (!isEditable()) return
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column
		if (columnName && editableColumnSet().has(columnName)) {
			editorStore.startResultEditing(props.tabId, props.resultIndex, index, columnName)
		}
	}

	function handleCellSave(rowIndex: number, column: string, value: unknown) {
		editorStore.setResultCellValue(props.tabId, props.resultIndex, rowIndex, column, value)
		editorStore.stopResultEditing(props.tabId)
	}

	function handleCellCancel() {
		editorStore.stopResultEditing(props.tabId)
	}

	function handleCellMoveNext(rowIndex: number, currentColumn: string) {
		const cols = columns()
		const editableCols = editableColumnSet()
		const idx = cols.findIndex((c) => c.name === currentColumn)
		for (let i = idx + 1; i < cols.length; i++) {
			if (editableCols.has(cols[i].name)) {
				editorStore.startResultEditing(props.tabId, props.resultIndex, rowIndex, cols[i].name)
				return
			}
		}
		editorStore.stopResultEditing(props.tabId)
	}

	function handleCellMoveDown(rowIndex: number, currentColumn: string) {
		const r = rows()
		if (rowIndex < r.length - 1) {
			editorStore.startResultEditing(props.tabId, props.resultIndex, rowIndex + 1, currentColumn)
		} else {
			editorStore.stopResultEditing(props.tabId)
		}
	}

	function getChangedCells(rowIndex: number): Set<string> {
		const changed = new Set<string>()
		const t = tab()
		if (!t) return changed
		const pending = t.resultPendingChanges[props.resultIndex]
		if (!pending) return changed
		for (const key of Object.keys(pending.cellEdits)) {
			const edit = pending.cellEdits[key]
			if (edit.rowIndex === rowIndex) {
				changed.add(edit.column)
			}
		}
		return changed
	}

	async function handleApply() {
		if (!hasPending()) return
		setApplying(true)
		setApplyError(null)
		try {
			await editorStore.applyResultChanges(props.tabId, props.resultIndex)
			editorStore.clearResultPendingChanges(props.tabId, props.resultIndex)
			setPreviewSql(null)
			setShowPendingPanel(false)
		} catch (err) {
			setApplyError(err instanceof Error ? err.message : String(err))
		} finally {
			setApplying(false)
		}
	}

	function handleRevert() {
		editorStore.revertResultChanges(props.tabId, props.resultIndex)
		setApplyError(null)
		setPreviewSql(null)
	}

	function handlePreviewSql() {
		try {
			const sql = editorStore.generateResultSqlPreview(props.tabId, props.resultIndex)
			setPreviewSql(sql)
		} catch (err) {
			setApplyError(err instanceof Error ? err.message : String(err))
		}
	}

	return (
		<div class="result-grid-wrapper">
			<div class="result-grid" ref={setScrollEl}>
				<GridHeader
					columns={columns()}
					sort={EMPTY_SORT}
					columnConfig={columnConfig()}
					pinStyles={EMPTY_PIN_STYLES}
					fkColumns={EMPTY_FK_COLUMNS}
					onToggleSort={noop}
					onResizeColumn={handleResizeColumn}
				/>
				<VirtualScroller
					scrollElement={scrollEl}
					rows={rows()}
					columns={columns()}
					columnConfig={columnConfig()}
					pinStyles={EMPTY_PIN_STYLES}
					selectedRows={selectedRows()}
					scrollMargin={HEADER_HEIGHT}
					onRowClick={handleRowClick}
					onRowDblClick={isEditable() ? handleRowDblClick : undefined}
					editingCell={isEditable() ? editingCell() : undefined}
					getChangedCells={isEditable() ? getChangedCells : undefined}
					onCellSave={isEditable() ? handleCellSave : undefined}
					onCellCancel={isEditable() ? handleCellCancel : undefined}
					onCellMoveNext={isEditable() ? handleCellMoveNext : undefined}
					onCellMoveDown={isEditable() ? handleCellMoveDown : undefined}
				/>
			</div>

			{/* Pending changes bar */}
			<Show when={hasPending()}>
				<div class="result-pending-bar">
					<div class="result-pending-bar__info">
						<Pencil size={12} />
						<span>{pendingCount()} pending change{pendingCount() !== 1 ? 's' : ''}</span>
					</div>
					<div class="result-pending-bar__actions">
						<button
							class="result-pending-bar__btn"
							onClick={() => setShowPendingPanel((v) => !v)}
							title={showPendingPanel() ? 'Hide details' : 'Show details'}
						>
							{showPendingPanel() ? 'Hide' : 'Details'}
						</button>
						<button
							class="result-pending-bar__btn result-pending-bar__btn--preview"
							onClick={handlePreviewSql}
							disabled={applying()}
							title="Preview SQL"
						>
							<Code size={12} /> SQL
						</button>
						<button
							class="result-pending-bar__btn result-pending-bar__btn--revert"
							onClick={handleRevert}
							disabled={applying()}
							title="Revert all changes"
						>
							<RotateCcw size={12} /> Revert
						</button>
						<button
							class="result-pending-bar__btn result-pending-bar__btn--apply"
							onClick={handleApply}
							disabled={applying()}
							title="Apply all changes"
						>
							<Check size={12} /> {applying() ? 'Applying...' : 'Apply'}
						</button>
					</div>
				</div>

				<Show when={applyError()}>
					<div class="result-pending-bar__error">{applyError()}</div>
				</Show>

				<Show when={previewSql()}>
					<div class="result-pending-bar__preview">
						<div class="result-pending-bar__preview-header">
							<span>SQL Preview</span>
							<button
								class="result-pending-bar__preview-close"
								onClick={() => setPreviewSql(null)}
								title="Close preview"
							>
								<X size={14} />
							</button>
						</div>
						<pre class="result-pending-bar__preview-sql">{previewSql()}</pre>
					</div>
				</Show>

				<Show when={showPendingPanel()}>
					<ResultPendingChangesList
						tabId={props.tabId}
						resultIndex={props.resultIndex}
						editability={props.editability!}
						disabled={applying()}
					/>
				</Show>
			</Show>
		</div>
	)
}

// ── Pending changes detail list ───────────────────────────

function ResultPendingChangesList(props: {
	tabId: string
	resultIndex: number
	editability: QueryEditability
	disabled: boolean
}) {
	const tab = () => editorStore.getTab(props.tabId)

	function formatValue(value: unknown): string {
		if (value === null || value === undefined) return 'NULL'
		if (typeof value === 'object') return JSON.stringify(value)
		return String(value)
	}

	function truncate(str: string, max: number): string {
		return str.length > max ? str.substring(0, max) + '...' : str
	}

	function buildItems(): Array<{ rowIndex: number; description: string }> {
		const t = tab()
		if (!t) return []
		const pending = t.resultPendingChanges[props.resultIndex]
		if (!pending) return []
		const pkColumns = props.editability.primaryKeys ?? []
		const items: Array<{ rowIndex: number; description: string }> = []

		// Group edits by row
		const editsByRow = new Map<number, Array<{ column: string; oldValue: unknown; newValue: unknown }>>()
		for (const edit of Object.values(pending.cellEdits)) {
			let rowEdits = editsByRow.get(edit.rowIndex)
			if (!rowEdits) {
				rowEdits = []
				editsByRow.set(edit.rowIndex, rowEdits)
			}
			rowEdits.push({ column: edit.column, oldValue: edit.oldValue, newValue: edit.newValue })
		}

		for (const [rowIndex, edits] of editsByRow) {
			const originalRow = t.results[props.resultIndex]?.rows[rowIndex]
			const pkDesc = pkColumns.map((pk) => `${pk}=${formatValue(originalRow?.[pk])}`).join(', ')
			const editDescs = edits.map(
				(e) => `${e.column}: ${truncate(formatValue(e.oldValue), 20)} \u2192 ${truncate(formatValue(e.newValue), 20)}`,
			)
			items.push({
				rowIndex,
				description: pkDesc ? `[${pkDesc}] ${editDescs.join('; ')}` : editDescs.join('; '),
			})
		}

		return items
	}

	return (
		<div class="result-pending-list">
			<For each={buildItems()}>
				{(item) => (
					<div class="result-pending-list__item">
						<span class="result-pending-list__item-icon">
							<Pencil size={12} />
						</span>
						<span class="result-pending-list__item-type">UPDATE</span>
						<span class="result-pending-list__item-desc" title={item.description}>
							{item.description}
						</span>
						<button
							class="result-pending-list__item-revert"
							onClick={() => editorStore.revertResultRowUpdate(props.tabId, props.resultIndex, item.rowIndex)}
							disabled={props.disabled}
							title="Revert this change"
						>
							<X size={14} />
						</button>
					</div>
				)}
			</For>
		</div>
	)
}
