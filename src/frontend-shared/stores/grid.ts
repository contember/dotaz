import { createStore } from 'solid-js/store'
import { buildCountQuery, buildQuickSearchClause, buildReadableSelectQuery, buildSelectQuery } from '../../shared/sql'
import type { ForeignKeyInfo } from '../../shared/types/database'
import type { ColumnFilter, GridColumnDef, SortColumn } from '../../shared/types/grid'
import type { RowColorRule } from '../../shared/types/rpc'
import { rpc } from '../lib/rpc'
import { createTabHelpers } from '../lib/tab-store-helpers'
import { connectionsStore } from './connections'
import { createGridColumnActions, getOrderedColumns, getVisibleColumns, computePinStyles } from './gridColumns'
import { createGridEditingActions, createDefaultPendingChanges } from './gridEditing'
import { createGridFkActions } from './gridFk'
import { createGridHeatmapActions, computeHeatmapStats, computeHeatmapColor } from './gridHeatmap'
import { createGridSelectionActions } from './gridSelection'
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

export interface NormalizedRange {
	minRow: number
	maxRow: number
	minCol: number
	maxCol: number
}

export interface CellSelection {
	focusedCell: { row: number; col: number } | null
	ranges: NormalizedRange[]
	anchor: { row: number; col: number } | null
	selectMode: 'cells' | 'rows' | 'columns'
}

function createDefaultSelection(): CellSelection {
	return { focusedCell: null, ranges: [], anchor: null, selectMode: 'cells' }
}

function normalizeRange(
	startRow: number,
	endRow: number,
	startCol: number,
	endCol: number,
): NormalizedRange {
	return {
		minRow: Math.min(startRow, endRow),
		maxRow: Math.max(startRow, endRow),
		minCol: Math.min(startCol, endCol),
		maxCol: Math.max(startCol, endCol),
	}
}

export function isCellInSelection(
	sel: CellSelection,
	row: number,
	col: number,
): boolean {
	for (const r of sel.ranges) {
		if (
			row >= r.minRow
			&& row <= r.maxRow
			&& col >= r.minCol
			&& col <= r.maxCol
		) {
			return true
		}
	}
	return false
}

export function getSelectedRowIndices(sel: CellSelection): number[] {
	const rows = new Set<number>()
	for (const r of sel.ranges) {
		for (let i = r.minRow; i <= r.maxRow; i++) rows.add(i)
	}
	return [...rows].sort((a, b) => a - b)
}

export function getSelectedColIndices(sel: CellSelection): number[] {
	const cols = new Set<number>()
	for (const r of sel.ranges) {
		for (let i = r.minCol; i <= r.maxCol; i++) cols.add(i)
	}
	return [...cols].sort((a, b) => a - b)
}

export function hasFullRowSelection(
	sel: CellSelection,
	totalCols: number,
): boolean {
	if (sel.ranges.length === 0) return false
	return sel.ranges.some((r) => r.minCol === 0 && r.maxCol === totalCols - 1)
}

export interface SelectionSnapshot {
	rowIndices: number[]
	colIndices: number[]
	rowCount: number
	cellCount: number
	columns: GridColumnDef[]
	rows: Record<string, unknown>[]
	hasExplicitSelection: boolean
	fallbackToAll: boolean
}

function projectRowToColumns(
	row: Record<string, unknown>,
	columns: GridColumnDef[],
): Record<string, unknown> {
	const projected: Record<string, unknown> = {}
	for (const column of columns) {
		projected[column.name] = row[column.name]
	}
	return projected
}

function getSelectionSnapshot(
	tabId: string,
	fallbackToAll = false,
): SelectionSnapshot | null {
	const tab = getTab(tabId)
	if (!tab) return null

	const visibleColumns = getVisibleColumns(tab)
	const selection = tab.selection

	if (selection.ranges.length === 0) {
		if (!fallbackToAll || visibleColumns.length === 0) return null

		const rowIndices = tab.rows
			.map((_, index) => index)
			.filter((index) => tab.rows[index] != null)

		return {
			rowIndices,
			colIndices: visibleColumns.map((_, index) => index),
			rowCount: rowIndices.length,
			cellCount: rowIndices.length * visibleColumns.length,
			columns: visibleColumns,
			rows: rowIndices.map((index) => projectRowToColumns(tab.rows[index], visibleColumns)),
			hasExplicitSelection: false,
			fallbackToAll: true,
		}
	}

	const colIndices = getSelectedColIndices(selection).filter(
		(index) => visibleColumns[index] != null,
	)
	if (colIndices.length === 0) return null

	const rowIndices = getSelectedRowIndices(selection).filter(
		(index) => tab.rows[index] != null,
	)
	const columns = colIndices.map((index) => visibleColumns[index])
	let cellCount = 0

	const rows = rowIndices.map((rowIndex) => {
		const row = tab.rows[rowIndex]
		const projected: Record<string, unknown> = {}

		for (const colIndex of colIndices) {
			if (!isCellInSelection(selection, rowIndex, colIndex)) continue
			const column = visibleColumns[colIndex]
			projected[column.name] = row[column.name]
			cellCount++
		}

		return projected
	})

	return {
		rowIndices,
		colIndices,
		rowCount: rowIndices.length,
		cellCount,
		columns,
		rows,
		hasExplicitSelection: true,
		fallbackToAll: false,
	}
}

// ── Per-tab grid state ───────────────────────────────────

export interface FocusedCell {
	row: number
	column: string
}

export interface EditingCell {
	row: number
	column: string
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
	heatmapColumns: Record<string, HeatmapMode>
	rowColorRules: RowColorRule[]
	rowColoringEnabled: boolean
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
		heatmapColumns: {},
		rowColorRules: [],
		rowColoringEnabled: true,
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

// fetchData is defined before viewActions since viewActions needs it
async function fetchData(tabId: string) {
	const tab = ensureTab(tabId)
	const requestId = ++fetchSequence
	latestFetchId.set(tabId, requestId)

	const fetchStart = Date.now()
	setState('tabs', tabId, 'loading', true)
	setState('tabs', tabId, 'totalCount', null)
	setState('tabs', tabId, 'countLoading', false)
	try {
		const dialect = connectionsStore.getDialect(tab.connectionId)

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
		const quickSearchClause = tab.quickSearch
			? buildQuickSearchClause(
				gridColumns,
				tab.quickSearch,
				dialect,
				filterParamCount,
			)
			: undefined

		// Build and execute data query
		const customFilter = tab.customFilter || undefined
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
	} catch (err) {
		// Ignore errors from stale requests
		if (latestFetchId.get(tabId) !== requestId) return

		setState('tabs', tabId, 'loading', false)
		// Re-throw so the global unhandled rejection handler in AppShell shows a toast
		throw err
	}
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
		const quickSearchClause = tab.quickSearch
			? buildQuickSearchClause(gridColumns, tab.quickSearch, dialect, filterParamCount)
			: undefined
		const customFilter = tab.customFilter || undefined
		const countQuery = buildCountQuery(tab.schema, tab.table, filters, dialect, quickSearchClause, customFilter)
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
	setState('tabs', tabId, 'currentPage', page)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setPageSize(tabId: string, pageSize: number) {
	ensureTab(tabId)
	setState('tabs', tabId, 'pageSize', pageSize)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function toggleSort(tabId: string, column: string, multi = false) {
	const tab = ensureTab(tabId)
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
	setState('tabs', tabId, 'quickSearch', search)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function setCustomFilter(tabId: string, filter: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'customFilter', filter)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function clearFilters(tabId: string) {
	ensureTab(tabId)
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

/** Format a cell value for TSV clipboard export. NULL -> empty string. */
function formatCellForClipboard(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
		.replace(/\t/g, ' ')
		.replace(/\n/g, ' ')
		.replace(/\r/g, '')
}

/**
 * Build TSV string for clipboard from current selection.
 * Returns the TSV text and the count of copied rows (0 = single cell).
 */
function buildClipboardTsv(
	tabId: string,
	visibleColumns: GridColumnDef[],
): { text: string; rowCount: number } | null {
	const tab = ensureTab(tabId)
	const sel = tab.selection
	if (sel.ranges.length === 0) return null

	const selectedRows = getSelectedRowIndices(sel)
	const selectedCols = getSelectedColIndices(sel)

	// Single cell -> copy just the cell value
	if (selectedRows.length === 1 && selectedCols.length === 1) {
		const row = tab.rows[selectedRows[0]]
		if (!row) return null
		const colName = visibleColumns[selectedCols[0]]?.name
		if (!colName) return null
		return { text: formatCellForClipboard(row[colName]), rowCount: 0 }
	}

	// Full row selection or multi-cell -> copy selected cells as TSV
	const colNames = selectedCols
		.map((i) => visibleColumns[i]?.name)
		.filter(Boolean) as string[]
	const header = colNames.join('\t')
	const rows = selectedRows
		.filter((i) => tab.rows[i] != null)
		.map((i) => {
			const row = tab.rows[i]
			return colNames.map((col) => formatCellForClipboard(row[col])).join('\t')
		})

	return { text: [header, ...rows].join('\n'), rowCount: selectedRows.length }
}

// ── Advanced copy ─────────────────────────────────────────

export type AdvancedCopyDelimiter =
	| 'tab'
	| 'comma'
	| 'semicolon'
	| 'pipe'
	| 'custom'
export type AdvancedCopyValueFormat = 'displayed' | 'raw' | 'quoted'

export interface AdvancedCopyOptions {
	delimiter: AdvancedCopyDelimiter
	customDelimiter: string
	includeHeaders: boolean
	includeRowNumbers: boolean
	valueFormat: AdvancedCopyValueFormat
	nullRepresentation: string
}

const DELIMITER_MAP: Record<
	Exclude<AdvancedCopyDelimiter, 'custom'>,
	string
> = {
	tab: '\t',
	comma: ',',
	semicolon: ';',
	pipe: '|',
}

function getDelimiterChar(options: AdvancedCopyOptions): string {
	return options.delimiter === 'custom'
		? options.customDelimiter || '\t'
		: DELIMITER_MAP[options.delimiter]
}

function formatAdvancedCellValue(
	value: unknown,
	options: AdvancedCopyOptions,
): string {
	if (value === null || value === undefined) return options.nullRepresentation

	const str = typeof value === 'object' ? JSON.stringify(value) : String(value)

	if (options.valueFormat === 'quoted') {
		// SQL-style quoting: wrap in single quotes, escape internal quotes
		return `'${str.replace(/'/g, "''")}'`
	}

	return str
}

/**
 * Build formatted clipboard text using advanced copy options.
 * Always copies all selected rows with visible columns (never single-cell mode).
 */
function buildAdvancedCopyText(
	tabId: string,
	visibleColumns: GridColumnDef[],
	options: AdvancedCopyOptions,
): string | null {
	const tab = ensureTab(tabId)
	const sel = tab.selection
	if (sel.ranges.length === 0) return null

	const delim = getDelimiterChar(options)
	const selectedRows = getSelectedRowIndices(sel)
	const selectedCols = getSelectedColIndices(sel)
	const colNames = selectedCols
		.map((i) => visibleColumns[i]?.name)
		.filter(Boolean) as string[]
	const lines: string[] = []

	if (options.includeHeaders) {
		const headerParts = options.includeRowNumbers
			? ['#', ...colNames]
			: colNames
		lines.push(headerParts.join(delim))
	}

	for (let i = 0; i < selectedRows.length; i++) {
		const rowIdx = selectedRows[i]
		const row = tab.rows[rowIdx]
		if (!row) continue
		const values = colNames.map((col) => formatAdvancedCellValue(row[col], options))
		if (options.includeRowNumbers) {
			values.unshift(String(i + 1))
		}
		lines.push(values.join(delim))
	}

	return lines.join('\n')
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

// ── Current SQL ──────────────────────────────────────────

function getCurrentSql(tabId: string): string | null {
	const tab = getTab(tabId)
	if (!tab) return null
	const dialect = connectionsStore.getDialect(tab.connectionId)
	if (!dialect) return null
	const filters = tab.filters.length > 0 ? tab.filters : undefined
	const sort = tab.sort.length > 0 ? tab.sort : undefined
	const customFilter = tab.customFilter || undefined
	return buildReadableSelectQuery(tab.schema, tab.table, tab.currentPage, tab.pageSize, sort, filters, dialect, customFilter)
}

// ── Editing: deleteSelectedRows wrapper ──────────────────

function deleteSelectedRows(tabId: string) {
	const tab = ensureTab(tabId)
	const selectedIndices = getSelectedRowIndices(tab.selection)
	editingActions.deleteSelectedRows(tabId, selectedIndices)
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

	// Saved views
	setActiveView: viewActions.setActiveView,
	applyViewConfig: viewActions.applyViewConfig,
	resetToDefault: viewActions.resetToDefault,
	captureViewConfig: viewActions.captureViewConfig,
	isViewModified: viewActions.isViewModified,

	// Aggregation
	getSelectedCellData,
	getSelectionSnapshot,

	// Editing
	startEditing: editingActions.startEditing,
	stopEditing: editingActions.stopEditing,
	setCellValue: editingActions.setCellValue,
	addNewRow: editingActions.addNewRow,
	pasteCells: editingActions.pasteCells,
	deleteSelectedRows,
	hasPendingChanges: editingActions.hasPendingChanges,
	pendingChangesCount: editingActions.pendingChangesCount,
	isCellChanged: editingActions.isCellChanged,
	isRowNew: editingActions.isRowNew,
	isRowDeleted: editingActions.isRowDeleted,
	buildDataChanges: editingActions.buildDataChanges,
	applyChanges: editingActions.applyChanges,
	generateSqlPreview: editingActions.generateSqlPreview,
	revertChanges: editingActions.revertChanges,
	clearPendingChanges: editingActions.clearPendingChanges,
	revertRowUpdate: editingActions.revertRowUpdate,
	revertNewRow: editingActions.revertNewRow,
	revertDeletedRow: editingActions.revertDeletedRow,
}
