import { buildCountQuery, buildQuickSearchClause, buildReadableSelectQuery, buildSelectQuery, createColumnResolver } from '@dotaz/shared/sql'
import type { JoinedColumnSet } from '@dotaz/shared/sql'
import type { ForeignKeyInfo } from '@dotaz/shared/types/database'
import type { AutoJoinDef, ColumnFilter, GridColumnDef, SortColumn } from '@dotaz/shared/types/grid'
import type { RowColorRule } from '@dotaz/shared/types/rpc'
import { createStore } from 'solid-js/store'
import { reconcileCellEdit } from '../lib/cell-edit-reconciliation'
import {
	type AdvancedCopyOptions,
	buildAdvancedCopyText as libBuildAdvancedCopyText,
	buildClipboardTsv as libBuildClipboardTsv,
	formatCellForClipboard as libFormatCellForClipboard,
} from '../lib/grid-clipboard'
import {
	buildSelectionSnapshot as libBuildSelectionSnapshot,
	type CellSelection,
	createDefaultSelection,
	getSelectedRowIndices,
	normalizeRange,
	type SelectionSnapshot,
} from '../lib/grid-selection'
import { rpc } from '../lib/rpc'
import { createTabHelpers } from '../lib/tab-store-helpers'
import { connectionsStore } from './connections'
import { createGridAutoJoinActions } from './gridAutoJoin'
import { computePinStyles, createGridColumnActions, getOrderedColumns, getVisibleColumns } from './gridColumns'
import { createDefaultPendingChanges, createGridEditingActions } from './gridEditing'
import { createGridFkActions } from './gridFk'
import { computeHeatmapColor, computeHeatmapStats, createGridHeatmapActions } from './gridHeatmap'
import {
	buildRowKey,
	createGridLiveModeActions,
	diffByPk,
	getPkColumns,
	intensityForAge,
	type LiveChanges,
	type LiveModeState,
	mergeAged,
	NEW_ROW_SENTINEL,
} from './gridLiveMode'
import { createGridSelectionActions } from './gridSelection'
import type { UndoSnapshot } from './gridUndoRedo'
import { createGridUndoRedoActions } from './gridUndoRedo'
import { createGridViewActions } from './gridViews'
import { sessionStore } from './session'
import { settingsStore } from './settings'

// ── Heatmap ───────────────────────────────────────────────

export type HeatmapMode = 'sequential' | 'diverging'

export interface HeatmapInfo {
	min: number
	max: number
	mode: HeatmapMode
}

// ── Column config (visibility, order, widths, pinned) ────

export interface ColumnConfig {
	visible: boolean
	width?: number
	pinned?: 'left' | 'right'
}

// ── Cell selection ────────────────────────────────────────
// Pure types and helpers live in `lib/grid-selection`. Re-exported here for
// backward-compatible imports from `stores/grid`.

export type { CellSelection, NormalizedRange, SelectionSnapshot } from '../lib/grid-selection'
export { createDefaultSelection, getSelectedColIndices, getSelectedRowIndices, hasFullRowSelection, isCellInSelection } from '../lib/grid-selection'

export type { LiveChanges, LiveIntervalMs, LiveModeState } from './gridLiveMode'
export { LIVE_INTERVALS } from './gridLiveMode'

function getSelectionSnapshot(
	tabId: string,
	fallbackToAll = false,
): SelectionSnapshot | null {
	const tab = getTab(tabId)
	if (!tab) return null
	return libBuildSelectionSnapshot(tab.rows, getVisibleColumns(tab), tab.selection, fallbackToAll)
}

// ── Per-tab grid state ───────────────────────────────────

export interface FocusedCell {
	row: number
	column: string
}

export interface EditingCell {
	row: number
	column: string
	initialValue?: unknown
}

/** A pending cell-level change, keyed by "rowIndex:columnName". */
export interface CellChange {
	rowIndex: number
	column: string
	oldValue: unknown
	newValue: unknown
}

/** Track new rows and deleted rows alongside cell edits. */
export interface PendingChanges {
	/** Cell-level edits keyed by "rowIndex:columnName". */
	cellEdits: Record<string, CellChange>
	/** Row indices of new rows (appended at end). */
	newRows: Set<number>
	/** Row indices marked for deletion. */
	deletedRows: Set<number>
}

/** FK target info for a single-column foreign key. */
export interface FkTarget {
	schema: string
	table: string
	column: string
}

/** Breadcrumb entry for FK peek/panel navigation. */
export interface FkBreadcrumb {
	schema: string
	table: string
	column: string
	value: unknown
}

/** State for the FK peek popover. */
export interface FkPeekState {
	anchorRect: { top: number; left: number; bottom: number; right: number }
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]
	breadcrumbs: FkBreadcrumb[]
	foreignKeys: ForeignKeyInfo[]
	schema: string
	table: string
	loading: boolean
}

/** State for the FK exploration panel. */
export interface FkPanelState {
	width: number
	schema: string
	table: string
	filters: ColumnFilter[]
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]
	breadcrumbs: FkBreadcrumb[]
	foreignKeys: ForeignKeyInfo[]
	totalCount: number | null
	countLoading: boolean
	currentPage: number
	currentRowIndex: number
	pageSize: number
	loading: boolean
}

export interface TabGridState {
	connectionId: string
	schema: string
	table: string
	database?: string
	columns: GridColumnDef[]
	rows: Record<string, unknown>[]
	totalCount: number | null
	countLoading: boolean
	currentPage: number
	pageSize: number
	sort: SortColumn[]
	filters: ColumnFilter[]
	customFilter: string
	quickSearch: string
	selection: CellSelection
	editingCell: EditingCell | null
	pendingChanges: PendingChanges
	columnConfig: Record<string, ColumnConfig>
	columnOrder: string[]
	loading: boolean
	lastLoadedAt: number | null
	fetchDuration: number | null
	activeViewId: string | null
	activeViewName: string | null
	fkPeek: FkPeekState | null
	fkPanel: FkPanelState | null
	transposed: boolean
	valueEditorOpen: boolean
	valueEditorWidth: number
	sidePanelOpen: boolean
	sidePanelWidth: number
	heatmapColumns: Record<string, HeatmapMode>
	rowColorRules: RowColorRule[]
	rowColoringEnabled: boolean
	autoJoins: AutoJoinDef[]
	undoStack: UndoSnapshot[]
	redoStack: UndoSnapshot[]
	liveMode: LiveModeState | null
	liveChanges: LiveChanges | null
}

function createDefaultTabState(
	connectionId: string,
	schema: string,
	table: string,
	database?: string,
): TabGridState {
	return {
		connectionId,
		schema,
		table,
		database,
		columns: [],
		rows: [],
		totalCount: null,
		countLoading: false,
		currentPage: 1,
		pageSize: 100,
		sort: [],
		filters: [],
		customFilter: '',
		quickSearch: '',
		selection: createDefaultSelection(),
		editingCell: null,
		pendingChanges: createDefaultPendingChanges(),
		columnConfig: {},
		columnOrder: [],
		loading: false,
		lastLoadedAt: null,
		fetchDuration: null,
		activeViewId: null,
		activeViewName: null,
		fkPeek: null,
		fkPanel: null,
		transposed: false,
		valueEditorOpen: false,
		valueEditorWidth: 350,
		sidePanelOpen: false,
		sidePanelWidth: 420,
		heatmapColumns: {},
		rowColorRules: [],
		rowColoringEnabled: true,
		autoJoins: [],
		undoStack: [],
		redoStack: [],
		liveMode: null,
		liveChanges: null,
	}
}

// ── Store ────────────────────────────────────────────────

export interface GridStoreState {
	tabs: Record<string, TabGridState>
}

const [state, setState] = createStore<GridStoreState>({
	tabs: {},
})

// ── Internal helpers ─────────────────────────────────────

/** Tracks the latest fetch request ID per tab to prevent stale responses. */
const latestFetchId = new Map<string, number>()
let fetchSequence = 0

const { getTab, ensureTab } = createTabHelpers(() => state.tabs, 'Grid')

// ── Domain module wiring ─────────────────────────────────

const heatmapActions = createGridHeatmapActions(state, setState, ensureTab)
const selectionActions = createGridSelectionActions(setState, ensureTab, normalizeRange, createDefaultSelection)
const fkActions = createGridFkActions(state, setState, ensureTab, getTab)
const columnActions = createGridColumnActions(state, setState, ensureTab)
const editingActions = createGridEditingActions(
	state,
	setState,
	ensureTab,
	getTab,
	getVisibleColumns,
	selectionActions.clearSelection,
)

const undoRedoActions = createGridUndoRedoActions(state, setState, ensureTab, getTab)

// fetchData is defined before viewActions since viewActions needs it
async function fetchData(tabId: string, opts: { live?: boolean } = {}) {
	const tab = ensureTab(tabId)
	const live = opts.live === true
	const requestId = ++fetchSequence
	latestFetchId.set(tabId, requestId)

	const fetchStart = Date.now()
	if (!live) {
		setState('tabs', tabId, 'loading', true)
		setState('tabs', tabId, 'totalCount', null)
		setState('tabs', tabId, 'countLoading', false)
	}
	try {
		const dialect = connectionsStore.getDialect(tab.connectionId)
		const hasJoins = tab.autoJoins.length > 0

		// Get column metadata from cached schema
		const cachedColumns = connectionsStore.getColumns(
			tab.connectionId,
			tab.schema,
			tab.table,
			tab.database,
		)
		const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
			name: c.name,
			dataType: c.dataType,
			nullable: c.nullable,
			isPrimaryKey: c.isPrimaryKey,
		}))

		// Build joined columns metadata
		const joinedColumnSets: JoinedColumnSet[] = []
		if (hasJoins) {
			for (const join of tab.autoJoins) {
				const refCols = connectionsStore.getColumns(
					tab.connectionId,
					join.referencedSchema,
					join.referencedTable,
					tab.database,
				)
				const colNames = refCols.map((c) => c.name)
				joinedColumnSets.push({
					alias: join.alias,
					table: join.referencedTable,
					columns: colNames,
				})
				for (const c of refCols) {
					gridColumns.push({
						name: `${join.referencedTable}.${c.name}`,
						dataType: c.dataType,
						nullable: true, // joined columns are always nullable (LEFT JOIN)
						isPrimaryKey: false,
						joinAlias: join.alias,
						sourceTable: join.referencedTable,
					})
				}
			}
		}

		// Build quick search clause if search term is provided
		const filters = tab.filters.length > 0 ? tab.filters : undefined
		const sort = tab.sort.length > 0 ? tab.sort : undefined
		const filterParamCount = (filters ?? []).reduce((sum, f) => {
			if (f.operator === 'isNull' || f.operator === 'isNotNull') return sum
			if (f.operator === 'in' || f.operator === 'notIn') {
				return sum + (Array.isArray(f.value) ? f.value.length : 1)
			}
			return sum + 1
		}, 0)

		const resolver = hasJoins ? createColumnResolver(tab.autoJoins, dialect) : undefined
		const quickSearchClause = tab.quickSearch
			? buildQuickSearchClause(
				gridColumns,
				tab.quickSearch,
				dialect,
				filterParamCount,
				resolver,
			)
			: undefined

		// Build and execute data query
		const customFilter = tab.customFilter || undefined
		const autoJoins = hasJoins ? tab.autoJoins : undefined
		const selectQuery = buildSelectQuery(
			tab.schema,
			tab.table,
			tab.currentPage,
			tab.pageSize,
			sort,
			filters,
			dialect,
			quickSearchClause,
			customFilter,
			autoJoins,
			joinedColumnSets.length > 0 ? joinedColumnSets : undefined,
		)

		// Execute data query (and optionally count query)
		const queryId = `grid-${tabId}-${requestId}`
		const sessionId = sessionStore.getSessionForTab(tabId)

		let dataResults: Awaited<ReturnType<typeof rpc.query.execute>>
		let totalRows: number | null = null

		if (settingsStore.gridConfig.autoCount) {
			const countQuery = buildCountQuery(
				tab.schema,
				tab.table,
				filters,
				dialect,
				quickSearchClause,
				customFilter,
				autoJoins,
			)
			const [dr, cr] = await Promise.all([
				rpc.query.execute({
					connectionId: tab.connectionId,
					sql: selectQuery.sql,
					queryId,
					params: selectQuery.params,
					database: tab.database,
					sessionId,
				}),
				rpc.query.execute({
					connectionId: tab.connectionId,
					sql: countQuery.sql,
					queryId: `${queryId}-count`,
					params: countQuery.params,
					database: tab.database,
					sessionId,
				}),
			])
			dataResults = dr
			totalRows = Number(cr[0]?.rows[0]?.count ?? 0)
		} else {
			dataResults = await rpc.query.execute({
				connectionId: tab.connectionId,
				sql: selectQuery.sql,
				queryId,
				params: selectQuery.params,
				database: tab.database,
				sessionId,
			})
		}

		// Ignore stale responses — a newer request has been issued
		if (latestFetchId.get(tabId) !== requestId) return

		const rows = dataResults[0]?.rows ?? []
		const fetchDuration = Date.now() - fetchStart

		if (live) {
			// Diff against existing rows by PK, then merge into the change ledger
			// with one tick of aging on prior entries.
			const pkCols = getPkColumns(gridColumns)
			const fresh = diffByPk(tab.rows, rows, pkCols, gridColumns)
			const prev = tab.liveChanges
			const nextAges = fresh
				? mergeAged(prev?.cellAges ?? null, fresh)
				: prev?.cellAges ?? new Map()
			setState('tabs', tabId, {
				columns: gridColumns,
				rows,
				totalCount: totalRows ?? tab.totalCount,
				countLoading: false,
				lastLoadedAt: Date.now(),
				fetchDuration,
				liveChanges: {
					cellAges: nextAges,
					tick: (prev?.tick ?? 0) + 1,
				},
			})
		} else {
			setState('tabs', tabId, {
				columns: gridColumns,
				rows,
				totalCount: totalRows,
				countLoading: false,
				currentPage: tab.currentPage,
				loading: false,
				lastLoadedAt: Date.now(),
				fetchDuration,
				selection: createDefaultSelection(),
				editingCell: null,
			})
			undoRedoActions.clearHistory(tabId)
		}
	} catch (err) {
		// Ignore errors from stale requests
		if (latestFetchId.get(tabId) !== requestId) return

		if (!live) {
			setState('tabs', tabId, 'loading', false)
			// Re-throw so the global unhandled rejection handler in AppShell shows a toast
			throw err
		}
		// Live-mode failures are silent — a transient network blip shouldn't
		// kill the polling loop. The user can manually disable Live mode if
		// something is persistently broken.
	}
}

const autoJoinActions = createGridAutoJoinActions(
	state,
	setState,
	ensureTab,
	createDefaultSelection,
	fetchData,
)

const liveModeActions = createGridLiveModeActions(
	state,
	setState,
	getTab,
	(tabId) => {
		const tab = getTab(tabId)
		// Pause silently while the user is mid-edit or has uncommitted changes —
		// fetching would clobber the diff baseline. The interval keeps running so
		// polling resumes the moment changes are committed/reverted.
		if (!tab || tab.editingCell != null || editingActions.hasPendingChanges(tabId)) {
			return Promise.resolve()
		}
		return fetchData(tabId, { live: true })
	},
	(tabId) => {
		const tab = getTab(tabId)
		if (!tab) return { ok: false, reason: 'Tab not found' }
		if (editingActions.hasPendingChanges(tabId)) {
			return { ok: false, reason: 'Commit or revert pending changes first' }
		}
		const pkCols = getPkColumns(tab.columns)
		if (pkCols.length === 0) {
			return { ok: false, reason: 'Table has no primary key — Live mode requires one to detect changes' }
		}
		return { ok: true }
	},
)

/** Stops live mode if it's active. Used by mutations that invalidate the diff baseline. */
function stopLiveModeIfActive(tabId: string) {
	if (liveModeActions.isActive(tabId)) liveModeActions.disable(tabId)
}

const viewActions = createGridViewActions(
	state,
	setState,
	ensureTab,
	getTab,
	getVisibleColumns,
	createDefaultSelection,
	fetchData,
)

// ── Data fetching & pagination ───────────────────────────

async function fetchGridCount(tabId: string) {
	const tab = getTab(tabId)
	if (!tab) return
	setState('tabs', tabId, 'countLoading', true)
	try {
		const dialect = connectionsStore.getDialect(tab.connectionId)
		const cachedColumns = connectionsStore.getColumns(
			tab.connectionId,
			tab.schema,
			tab.table,
			tab.database,
		)
		const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
			name: c.name,
			dataType: c.dataType,
			nullable: c.nullable,
			isPrimaryKey: c.isPrimaryKey,
		}))
		const filters = tab.filters.length > 0 ? tab.filters : undefined
		const filterParamCount = (filters ?? []).reduce((sum, f) => {
			if (f.operator === 'isNull' || f.operator === 'isNotNull') return sum
			if (f.operator === 'in' || f.operator === 'notIn') {
				return sum + (Array.isArray(f.value) ? f.value.length : 1)
			}
			return sum + 1
		}, 0)
		const hasJoins = tab.autoJoins.length > 0
		const resolver = hasJoins ? createColumnResolver(tab.autoJoins, dialect) : undefined
		const quickSearchClause = tab.quickSearch
			? buildQuickSearchClause(gridColumns, tab.quickSearch, dialect, filterParamCount, resolver)
			: undefined
		const customFilter = tab.customFilter || undefined
		const countQuery = buildCountQuery(tab.schema, tab.table, filters, dialect, quickSearchClause, customFilter, hasJoins ? tab.autoJoins : undefined)
		const sessionId = sessionStore.getSessionForTab(tabId)
		const results = await rpc.query.execute({
			connectionId: tab.connectionId,
			sql: countQuery.sql,
			queryId: `grid-count-${tabId}`,
			params: countQuery.params,
			database: tab.database,
			sessionId,
		})
		setState('tabs', tabId, 'totalCount', Number(results[0]?.rows[0]?.count ?? 0))
	} catch {
		// Silently ignore count errors
	} finally {
		setState('tabs', tabId, 'countLoading', false)
	}
}

// ── Actions ──────────────────────────────────────────────

async function loadTableData(
	tabId: string,
	connectionId: string,
	schema: string,
	table: string,
	database?: string,
) {
	if (!getTab(tabId)) {
		setState(
			'tabs',
			tabId,
			createDefaultTabState(connectionId, schema, table, database),
		)
	}
	await fetchData(tabId)
}

async function refreshData(tabId: string) {
	ensureTab(tabId)
	await fetchData(tabId)
}

async function setPage(tabId: string, page: number) {
	ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState('tabs', tabId, 'currentPage', page)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setPageSize(tabId: string, pageSize: number) {
	ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState('tabs', tabId, 'pageSize', pageSize)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function toggleSort(tabId: string, column: string, multi = false) {
	const tab = ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	const existing = tab.sort.find((s) => s.column === column)
	let newSort: SortColumn[]

	if (!multi) {
		// Single sort: replace entire sort list with this column
		if (!existing) {
			newSort = [{ column, direction: 'asc' }]
		} else if (existing.direction === 'asc') {
			newSort = [{ column, direction: 'desc' }]
		} else {
			newSort = []
		}
	} else {
		// Multi-sort: add/toggle/remove within existing list
		if (!existing) {
			newSort = [...tab.sort, { column, direction: 'asc' }]
		} else if (existing.direction === 'asc') {
			newSort = tab.sort.map((s) => s.column === column ? { column, direction: 'desc' as const } : s)
		} else {
			newSort = tab.sort.filter((s) => s.column !== column)
		}
	}

	setState('tabs', tabId, 'sort', newSort)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setFilter(tabId: string, filter: ColumnFilter) {
	const tab = ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	const idx = tab.filters.findIndex((f) => f.column === filter.column)
	if (idx === -1) {
		setState('tabs', tabId, 'filters', [...tab.filters, filter])
	} else {
		setState('tabs', tabId, 'filters', (filters) => filters.map((f, i) => (i === idx ? filter : f)))
	}
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function removeFilter(tabId: string, column: string) {
	const tab = ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState(
		'tabs',
		tabId,
		'filters',
		tab.filters.filter((f) => f.column !== column),
	)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setQuickSearch(tabId: string, search: string) {
	ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState('tabs', tabId, 'quickSearch', search)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setCustomFilter(tabId: string, filter: string) {
	ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState('tabs', tabId, 'customFilter', filter)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function clearFilters(tabId: string) {
	ensureTab(tabId)
	stopLiveModeIfActive(tabId)
	setState('tabs', tabId, 'filters', [])
	setState('tabs', tabId, 'customFilter', '')
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

function getSelectedData(tabId: string): Record<string, unknown>[] {
	const tab = ensureTab(tabId)
	const indices = getSelectedRowIndices(tab.selection)
	return indices.filter((i) => tab.rows[i] != null).map((i) => tab.rows[i])
}

// ── Clipboard wrappers ───────────────────────────────────
// Re-export advanced-copy types and delegate the per-tab helpers to lib.

export type { AdvancedCopyDelimiter, AdvancedCopyOptions, AdvancedCopyValueFormat } from '../lib/grid-clipboard'

const formatCellForClipboard = libFormatCellForClipboard

function buildClipboardTsv(
	tabId: string,
	visibleColumns: GridColumnDef[],
): { text: string; rowCount: number } | null {
	const tab = ensureTab(tabId)
	return libBuildClipboardTsv(tab.rows, visibleColumns, tab.selection)
}

function buildAdvancedCopyText(
	tabId: string,
	visibleColumns: GridColumnDef[],
	options: AdvancedCopyOptions,
): string | null {
	const tab = ensureTab(tabId)
	return libBuildAdvancedCopyText(tab.rows, visibleColumns, tab.selection, options)
}

// ── Transpose & value editor ─────────────────────────────

function toggleTranspose(tabId: string) {
	const tab = ensureTab(tabId)
	setState('tabs', tabId, 'transposed', !tab.transposed)
}

function toggleValueEditor(tabId: string) {
	const tab = ensureTab(tabId)
	// Close FK panel if opening value editor (mutually exclusive)
	if (!tab.valueEditorOpen && tab.fkPanel) {
		setState('tabs', tabId, 'fkPanel', null)
	}
	setState('tabs', tabId, 'valueEditorOpen', !tab.valueEditorOpen)
}

function setValueEditorWidth(tabId: string, width: number) {
	ensureTab(tabId)
	setState(
		'tabs',
		tabId,
		'valueEditorWidth',
		Math.min(800, Math.max(200, width)),
	)
}

function setSidePanelOpen(tabId: string, open: boolean) {
	ensureTab(tabId)
	setState('tabs', tabId, 'sidePanelOpen', open)
}

function setSidePanelWidth(tabId: string, width: number) {
	ensureTab(tabId)
	setState(
		'tabs',
		tabId,
		'sidePanelWidth',
		Math.min(1200, Math.max(250, width)),
	)
}

// ── Row coloring ─────────────────────────────────────────

function setRowColorRules(tabId: string, rules: RowColorRule[]) {
	ensureTab(tabId)
	setState('tabs', tabId, 'rowColorRules', rules)
}

function toggleRowColoring(tabId: string) {
	const tab = ensureTab(tabId)
	setState('tabs', tabId, 'rowColoringEnabled', !tab.rowColoringEnabled)
}

function evaluateRowColor(row: Record<string, unknown>, rules: RowColorRule[]): string | undefined {
	for (const rule of rules) {
		const cellValue = row[rule.column]
		if (matchesRule(cellValue, rule.operator, rule.value)) {
			return rule.color
		}
	}
	return undefined
}

function matchesRule(cellValue: unknown, operator: string, ruleValue: unknown): boolean {
	if (operator === 'isNull') return cellValue == null
	if (operator === 'isNotNull') return cellValue != null

	if (cellValue == null) return false

	const strCell = String(cellValue)
	const strRule = String(ruleValue ?? '')

	switch (operator) {
		case 'eq':
			return strCell === strRule
		case 'neq':
			return strCell !== strRule
		case 'gt':
			return Number(cellValue) > Number(ruleValue)
		case 'gte':
			return Number(cellValue) >= Number(ruleValue)
		case 'lt':
			return Number(cellValue) < Number(ruleValue)
		case 'lte':
			return Number(cellValue) <= Number(ruleValue)
		case 'like': {
			const pattern = strRule.replace(/%/g, '.*').replace(/_/g, '.')
			return new RegExp(`^${pattern}$`, 'i').test(strCell)
		}
		case 'notLike': {
			const pattern = strRule.replace(/%/g, '.*').replace(/_/g, '.')
			return !new RegExp(`^${pattern}$`, 'i').test(strCell)
		}
		case 'in': {
			const values = Array.isArray(ruleValue) ? ruleValue.map(String) : strRule.split(',').map((v) => v.trim())
			return values.includes(strCell)
		}
		case 'notIn': {
			const values = Array.isArray(ruleValue) ? ruleValue.map(String) : strRule.split(',').map((v) => v.trim())
			return !values.includes(strCell)
		}
		default:
			return false
	}
}

function removeTab(tabId: string) {
	liveModeActions.disposeTab(tabId)
	latestFetchId.delete(tabId)
	setState('tabs', tabId, undefined!)
}

// ── Aggregate selection data ──────────────────────────────

/** Return selected rows data and columns for aggregate computation. */
function getSelectedCellData(
	tabId: string,
): { rows: Record<string, unknown>[]; columns: GridColumnDef[] } | null {
	const snapshot = getSelectionSnapshot(tabId)
	if (!snapshot || snapshot.rowCount < 2) return null
	return { rows: snapshot.rows, columns: snapshot.columns }
}

// ── Live mode helpers ────────────────────────────────────

/** Intensity (0..1) of the highlight for a given cell, or 0 if no recent change. */
function getLiveCellIntensity(tabId: string, rowIndex: number, column: string): number {
	const tab = getTab(tabId)
	if (!tab?.liveChanges) return 0
	const row = tab.rows[rowIndex]
	if (!row) return 0
	const pkCols = getPkColumns(tab.columns)
	const key = buildRowKey(row, pkCols)
	if (key == null) return 0
	const perCell = tab.liveChanges.cellAges.get(key)
	if (!perCell) return 0
	const age = perCell.get(column)
	if (age == null) return 0
	return intensityForAge(age)
}

/** Intensity (0..1) for the "row is new" highlight, or 0 if the row isn't new. */
function getLiveRowNewIntensity(tabId: string, rowIndex: number): number {
	const tab = getTab(tabId)
	if (!tab?.liveChanges) return 0
	const row = tab.rows[rowIndex]
	if (!row) return 0
	const pkCols = getPkColumns(tab.columns)
	const key = buildRowKey(row, pkCols)
	if (key == null) return 0
	const perCell = tab.liveChanges.cellAges.get(key)
	if (!perCell) return 0
	const age = perCell.get(NEW_ROW_SENTINEL)
	if (age == null) return 0
	return intensityForAge(age)
}

/** Helper to build a row key from PK columns. Re-exported here for components. */
function rowKey(tabId: string, rowIndex: number): string | null {
	const tab = getTab(tabId)
	if (!tab) return null
	const row = tab.rows[rowIndex]
	if (!row) return null
	return buildRowKey(row, getPkColumns(tab.columns))
}

// ── Current SQL ──────────────────────────────────────────

function getCurrentSql(tabId: string): string | null {
	const tab = getTab(tabId)
	if (!tab) return null
	const dialect = connectionsStore.getDialect(tab.connectionId)
	if (!dialect) return null
	const filters = tab.filters.length > 0 ? tab.filters : undefined
	const sort = tab.sort.length > 0 ? tab.sort : undefined
	const customFilter = tab.customFilter || undefined

	const autoJoins = tab.autoJoins.length > 0 ? tab.autoJoins : undefined
	let joinedColumnSets: JoinedColumnSet[] | undefined
	if (autoJoins) {
		joinedColumnSets = autoJoins.map((join) => {
			const refCols = connectionsStore.getColumns(
				tab.connectionId,
				join.referencedSchema,
				join.referencedTable,
				tab.database,
			)
			return { alias: join.alias, table: join.referencedTable, columns: refCols.map((c) => c.name) }
		})
	}

	return buildReadableSelectQuery(
		tab.schema,
		tab.table,
		tab.currentPage,
		tab.pageSize,
		sort,
		filters,
		dialect,
		customFilter,
		autoJoins,
		joinedColumnSets,
	)
}

// ── Editing: deleteSelectedRows wrapper ──────────────────

function deleteSelectedRows(tabId: string) {
	const tab = ensureTab(tabId)
	const selectedIndices = getSelectedRowIndices(tab.selection)
	undoRedoActions.pushSnapshot(tabId)
	editingActions.deleteSelectedRows(tabId, selectedIndices)
}

function setCellValueWithUndo(tabId: string, rowIndex: number, column: string, newValue: unknown) {
	const tab = getTab(tabId)
	if (tab) {
		const result = reconcileCellEdit({
			rowIndex,
			column,
			currentValue: tab.rows[rowIndex]?.[column],
			existingEdit: tab.pendingChanges.cellEdits[`${rowIndex}:${column}`],
			newValue,
		})
		if (result.type === 'noop') return
	}
	undoRedoActions.pushSnapshot(tabId)
	editingActions.setCellValue(tabId, rowIndex, column, newValue)
}

function addNewRowWithUndo(tabId: string): number {
	undoRedoActions.pushSnapshot(tabId)
	return editingActions.addNewRow(tabId)
}

function pasteCellsWithUndo(tabId: string, startRow: number, startColumn: string, data: unknown[][]) {
	undoRedoActions.withUndoGroup(tabId, () => {
		editingActions.pasteCells(tabId, startRow, startColumn, data)
	})
}

function clearPendingChangesWithUndo(tabId: string) {
	editingActions.clearPendingChanges(tabId)
	undoRedoActions.clearHistory(tabId)
}

function revertChangesWithUndo(tabId: string) {
	editingActions.revertChanges(tabId)
	undoRedoActions.clearHistory(tabId)
}

// ── Export ────────────────────────────────────────────────

export const gridStore = {
	getTab,
	getCurrentSql,

	loadTableData,
	refreshData,
	fetchGridCount,
	setPage,
	setPageSize,
	toggleSort,
	setFilter,
	removeFilter,
	clearFilters,
	setCustomFilter,
	setQuickSearch,
	selectCell: selectionActions.selectCell,
	extendSelection: selectionActions.extendSelection,
	addCellRange: selectionActions.addCellRange,
	extendLastRange: selectionActions.extendLastRange,
	selectFullRow: selectionActions.selectFullRow,
	selectFullRowRange: selectionActions.selectFullRowRange,
	toggleFullRow: selectionActions.toggleFullRow,
	selectFullColumn: selectionActions.selectFullColumn,
	selectFullColumnRange: selectionActions.selectFullColumnRange,
	toggleFullColumn: selectionActions.toggleFullColumn,
	selectAll: selectionActions.selectAll,
	moveFocus: selectionActions.moveFocus,
	extendFocus: selectionActions.extendFocus,
	clearSelection: selectionActions.clearSelection,
	setSelection: selectionActions.setSelection,
	getSelectedData,
	setFocusedCell: selectionActions.setFocusedCell,
	buildClipboardTsv,
	buildAdvancedCopyText,
	formatCellForClipboard,
	setColumnWidth: columnActions.setColumnWidth,
	setColumnVisibility: columnActions.setColumnVisibility,
	setColumnPinned: columnActions.setColumnPinned,
	setColumnOrder: columnActions.setColumnOrder,
	resetColumnConfig: columnActions.resetColumnConfig,
	getOrderedColumns,
	getVisibleColumns,
	computePinStyles,
	removeTab,

	// Heatmap
	setHeatmap: heatmapActions.setHeatmap,
	removeHeatmap: heatmapActions.removeHeatmap,
	computeHeatmapStats,
	computeHeatmapColor,

	// Row coloring
	setRowColorRules,
	toggleRowColoring,
	evaluateRowColor,

	// Transpose
	toggleTranspose,

	// Value editor
	toggleValueEditor,
	setValueEditorWidth,

	// Side panel (row-detail / value / selection / FK panel container)
	setSidePanelOpen,
	setSidePanelWidth,

	// FK peek popover
	openFkPeek: fkActions.openFkPeek,
	openPkPeek: fkActions.openPkPeek,
	closeFkPeek: fkActions.closeFkPeek,
	fkPeekNavigate: fkActions.fkPeekNavigate,
	fkPeekBack: fkActions.fkPeekBack,

	// FK exploration panel
	openFkPanel: fkActions.openFkPanel,
	closeFkPanel: fkActions.closeFkPanel,
	refreshFkPanel: fkActions.refreshFkPanel,
	fetchFkPanelCount: fkActions.fetchFkPanelCount,
	fkPanelNavigate: fkActions.fkPanelNavigate,
	fkPanelBack: fkActions.fkPanelBack,
	fkPanelResize: fkActions.fkPanelResize,
	fkPanelSetPage: fkActions.fkPanelSetPage,
	fkPanelSetRowIndex: fkActions.fkPanelSetRowIndex,

	// Auto-join
	addAutoJoin: autoJoinActions.addAutoJoin,
	removeAutoJoin: autoJoinActions.removeAutoJoin,
	removeAllAutoJoins: autoJoinActions.removeAllAutoJoins,

	// Saved views
	setActiveView: viewActions.setActiveView,
	applyViewConfig: viewActions.applyViewConfig,
	resetToDefault: viewActions.resetToDefault,
	captureViewConfig: viewActions.captureViewConfig,
	isViewModified: viewActions.isViewModified,

	// Aggregation
	getSelectedCellData,
	getSelectionSnapshot,

	// Undo/Redo
	undo: undoRedoActions.undo,
	redo: undoRedoActions.redo,
	canUndo: undoRedoActions.canUndo,
	canRedo: undoRedoActions.canRedo,
	withUndoGroup: undoRedoActions.withUndoGroup,

	// Live mode
	enableLiveMode: liveModeActions.enable,
	disableLiveMode: liveModeActions.disable,
	setLiveModeInterval: liveModeActions.setInterval,
	isLiveModeActive: liveModeActions.isActive,
	getLiveCellIntensity,
	getLiveRowNewIntensity,
	liveRowKey: rowKey,

	// Editing
	startEditing: editingActions.startEditing,
	stopEditing: editingActions.stopEditing,
	setCellValue: setCellValueWithUndo,
	addNewRow: addNewRowWithUndo,
	pasteCells: pasteCellsWithUndo,
	deleteSelectedRows,
	hasPendingChanges: editingActions.hasPendingChanges,
	pendingChangesCount: editingActions.pendingChangesCount,
	isCellChanged: editingActions.isCellChanged,
	isRowNew: editingActions.isRowNew,
	isRowDeleted: editingActions.isRowDeleted,
	buildDataChanges: editingActions.buildDataChanges,
	applyChanges: editingActions.applyChanges,
	generateSqlPreview: editingActions.generateSqlPreview,
	revertChanges: revertChangesWithUndo,
	clearPendingChanges: clearPendingChangesWithUndo,
	clearAppliedChanges: editingActions.clearAppliedChanges,
	revertRowUpdate: editingActions.revertRowUpdate,
	revertNewRow: editingActions.revertNewRow,
	revertDeletedRow: editingActions.revertDeletedRow,
}
