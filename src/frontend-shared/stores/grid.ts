import { createStore } from 'solid-js/store'
import { buildCountQuery, buildQuickSearchClause, buildSelectQuery, generateChangesPreview, generateChangeSql } from '../../shared/sql'
import type { ForeignKeyInfo } from '../../shared/types/database'
import type { ColumnFilter, GridColumnDef, SortColumn } from '../../shared/types/grid'
import type { DataChange, SavedViewConfig } from '../../shared/types/rpc'
import { isNumericType } from '../lib/column-types'
import { DEFAULT_COLUMN_WIDTH } from '../lib/layout-constants'
import { rpc } from '../lib/rpc'
import { createTabHelpers } from '../lib/tab-store-helpers'
import { connectionsStore } from './connections'
import { sessionStore } from './session'

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

function normalizeRange(startRow: number, endRow: number, startCol: number, endCol: number): NormalizedRange {
	return {
		minRow: Math.min(startRow, endRow),
		maxRow: Math.max(startRow, endRow),
		minCol: Math.min(startCol, endCol),
		maxCol: Math.max(startCol, endCol),
	}
}

export function isCellInSelection(sel: CellSelection, row: number, col: number): boolean {
	for (const r of sel.ranges) {
		if (row >= r.minRow && row <= r.maxRow && col >= r.minCol && col <= r.maxCol) return true
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

export function hasFullRowSelection(sel: CellSelection, totalCols: number): boolean {
	if (sel.ranges.length === 0) return false
	return sel.ranges.some((r) => r.minCol === 0 && r.maxCol === totalCols - 1)
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
	totalCount: number
	currentPage: number
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
	totalCount: number
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
}

function createDefaultPendingChanges(): PendingChanges {
	return {
		cellEdits: {},
		newRows: new Set(),
		deletedRows: new Set(),
	}
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
		totalCount: 0,
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
	}
}

// ── Store ────────────────────────────────────────────────

interface GridStoreState {
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

async function fetchData(tabId: string) {
	const tab = ensureTab(tabId)
	const requestId = ++fetchSequence
	latestFetchId.set(tabId, requestId)

	const fetchStart = Date.now()
	setState('tabs', tabId, 'loading', true)
	try {
		const dialect = connectionsStore.getDialect(tab.connectionId)

		// Get column metadata from cached schema
		const cachedColumns = connectionsStore.getColumns(tab.connectionId, tab.schema, tab.table, tab.database)
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
			? buildQuickSearchClause(gridColumns, tab.quickSearch, dialect, filterParamCount)
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
		const countQuery = buildCountQuery(tab.schema, tab.table, filters, dialect, quickSearchClause, customFilter)

		// Execute both queries
		const queryId = `grid-${tabId}-${requestId}`
		const sessionId = sessionStore.getSessionForTab(tabId)
		const [dataResults, countResults] = await Promise.all([
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

		// Ignore stale responses — a newer request has been issued
		if (latestFetchId.get(tabId) !== requestId) return

		const rows = dataResults[0]?.rows ?? []
		const totalRows = Number(countResults[0]?.rows[0]?.count ?? 0)

		const fetchDuration = Date.now() - fetchStart

		setState('tabs', tabId, {
			columns: gridColumns,
			rows,
			totalCount: totalRows,
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

// ── Actions ──────────────────────────────────────────────

async function loadTableData(
	tabId: string,
	connectionId: string,
	schema: string,
	table: string,
	database?: string,
) {
	if (!getTab(tabId)) {
		setState('tabs', tabId, createDefaultTabState(connectionId, schema, table, database))
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

function selectCell(tabId: string, row: number, col: number) {
	ensureTab(tabId)
	const range = normalizeRange(row, row, col, col)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row, col },
		ranges: [range],
		anchor: { row, col },
		selectMode: 'cells',
	})
}

function extendSelection(tabId: string, toRow: number, toCol: number) {
	const tab = ensureTab(tabId)
	const anchor = tab.selection.anchor ?? { row: toRow, col: toCol }
	const range = normalizeRange(anchor.row, toRow, anchor.col, toCol)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row: toRow, col: toCol },
		ranges: [range],
		anchor,
		selectMode: tab.selection.selectMode,
	})
}

function addCellRange(tabId: string, row: number, col: number) {
	const tab = ensureTab(tabId)
	const range = normalizeRange(row, row, col, col)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row, col },
		ranges: [...tab.selection.ranges, range],
		anchor: { row, col },
		selectMode: 'cells',
	})
}

function selectFullRow(tabId: string, rowIndex: number, totalCols: number) {
	ensureTab(tabId)
	const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row: rowIndex, col: 0 },
		ranges: [range],
		anchor: { row: rowIndex, col: 0 },
		selectMode: 'rows',
	})
}

function selectFullRowRange(tabId: string, from: number, to: number, totalCols: number) {
	const tab = ensureTab(tabId)
	const anchor = tab.selection.anchor ?? { row: from, col: 0 }
	const range = normalizeRange(anchor.row, to, 0, totalCols - 1)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row: to, col: 0 },
		ranges: [range],
		anchor,
		selectMode: 'rows',
	})
}

function toggleFullRow(tabId: string, rowIndex: number, totalCols: number) {
	const tab = ensureTab(tabId)
	const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
	// Check if this row is already fully selected
	const alreadySelected = tab.selection.ranges.some(
		(r) => r.minRow <= rowIndex && r.maxRow >= rowIndex && r.minCol === 0 && r.maxCol === totalCols - 1,
	)
	if (alreadySelected) {
		// Remove ranges that fully cover this row
		const filtered = tab.selection.ranges.filter(
			(r) => !(r.minRow === rowIndex && r.maxRow === rowIndex),
		)
		setState('tabs', tabId, 'selection', {
			focusedCell: filtered.length > 0 ? tab.selection.focusedCell : null,
			ranges: filtered,
			anchor: { row: rowIndex, col: 0 },
			selectMode: 'rows',
		})
	} else {
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: rowIndex, col: 0 },
			ranges: [...tab.selection.ranges, range],
			anchor: { row: rowIndex, col: 0 },
			selectMode: 'rows',
		})
	}
}

function selectFullColumn(tabId: string, colIndex: number, totalRows: number) {
	ensureTab(tabId)
	const range = normalizeRange(0, totalRows - 1, colIndex, colIndex)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row: 0, col: colIndex },
		ranges: [range],
		anchor: { row: 0, col: colIndex },
		selectMode: 'columns',
	})
}

function selectAll(tabId: string, totalRows: number, totalCols: number) {
	ensureTab(tabId)
	if (totalRows === 0 || totalCols === 0) return
	const range = normalizeRange(0, totalRows - 1, 0, totalCols - 1)
	setState('tabs', tabId, 'selection', {
		focusedCell: { row: 0, col: 0 },
		ranges: [range],
		anchor: { row: 0, col: 0 },
		selectMode: 'rows',
	})
}

function moveFocus(tabId: string, dRow: number, dCol: number, totalRows: number, totalCols: number) {
	const tab = ensureTab(tabId)
	const current = tab.selection.focusedCell ?? { row: 0, col: 0 }
	const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
	const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
	selectCell(tabId, row, col)
}

function extendFocus(tabId: string, dRow: number, dCol: number, totalRows: number, totalCols: number) {
	const tab = ensureTab(tabId)
	const current = tab.selection.focusedCell ?? { row: 0, col: 0 }
	const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
	const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
	extendSelection(tabId, row, col)
}

function clearSelection(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'selection', createDefaultSelection())
}

/** Legacy compatibility: set focused cell by column name */
function setFocusedCell(tabId: string, cell: FocusedCell | null, visibleColumns?: GridColumnDef[]) {
	const tab = ensureTab(tabId)
	if (!cell) {
		setState('tabs', tabId, 'selection', { ...tab.selection, focusedCell: null })
		return
	}
	const colIdx = visibleColumns
		? visibleColumns.findIndex((c) => c.name === cell.column)
		: 0
	selectCell(tabId, cell.row, Math.max(0, colIdx))
}

function getSelectedData(tabId: string): Record<string, unknown>[] {
	const tab = ensureTab(tabId)
	const indices = getSelectedRowIndices(tab.selection)
	return indices.filter((i) => tab.rows[i] != null).map((i) => tab.rows[i])
}

/** Format a cell value for TSV clipboard export. NULL → empty string. */
function formatCellForClipboard(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value).replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '')
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

	// Single cell → copy just the cell value
	if (selectedRows.length === 1 && selectedCols.length === 1) {
		const row = tab.rows[selectedRows[0]]
		if (!row) return null
		const colName = visibleColumns[selectedCols[0]]?.name
		if (!colName) return null
		return { text: formatCellForClipboard(row[colName]), rowCount: 0 }
	}

	// Full row selection or multi-cell → copy selected cells as TSV
	const colNames = selectedCols.map((i) => visibleColumns[i]?.name).filter(Boolean) as string[]
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

export type AdvancedCopyDelimiter = 'tab' | 'comma' | 'semicolon' | 'pipe' | 'custom'
export type AdvancedCopyValueFormat = 'displayed' | 'raw' | 'quoted'

export interface AdvancedCopyOptions {
	delimiter: AdvancedCopyDelimiter
	customDelimiter: string
	includeHeaders: boolean
	includeRowNumbers: boolean
	valueFormat: AdvancedCopyValueFormat
	nullRepresentation: string
}

const DELIMITER_MAP: Record<Exclude<AdvancedCopyDelimiter, 'custom'>, string> = {
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

function formatAdvancedCellValue(value: unknown, options: AdvancedCopyOptions): string {
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
	const colNames = selectedCols.map((i) => visibleColumns[i]?.name).filter(Boolean) as string[]
	const lines: string[] = []

	if (options.includeHeaders) {
		const headerParts = options.includeRowNumbers ? ['#', ...colNames] : colNames
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

function setColumnWidth(tabId: string, column: string, width: number) {
	const tab = ensureTab(tabId)
	const existing = tab.columnConfig[column]
	setState('tabs', tabId, 'columnConfig', {
		...tab.columnConfig,
		[column]: {
			visible: existing?.visible ?? true,
			width: Math.max(50, width),
			pinned: existing?.pinned,
		},
	})
}

function setColumnVisibility(tabId: string, column: string, visible: boolean) {
	const tab = ensureTab(tabId)
	const existing = tab.columnConfig[column]
	setState('tabs', tabId, 'columnConfig', {
		...tab.columnConfig,
		[column]: {
			visible,
			width: existing?.width,
			pinned: existing?.pinned,
		},
	})
}

function setColumnPinned(
	tabId: string,
	column: string,
	pinned: 'left' | 'right' | undefined,
) {
	const tab = ensureTab(tabId)
	const existing = tab.columnConfig[column]
	setState('tabs', tabId, 'columnConfig', {
		...tab.columnConfig,
		[column]: {
			visible: existing?.visible ?? true,
			width: existing?.width,
			pinned,
		},
	})
}

function setColumnOrder(tabId: string, order: string[]) {
	setState('tabs', tabId, 'columnOrder', order)
}

function resetColumnConfig(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'columnConfig', {})
	setState('tabs', tabId, 'columnOrder', [])
}

/** Returns all columns in user-defined order (or natural order). Includes hidden columns. */
function getOrderedColumns(tab: TabGridState): GridColumnDef[] {
	if (tab.columnOrder.length === 0) return tab.columns
	const orderMap = new Map(tab.columnOrder.map((name, i) => [name, i]))
	return [...tab.columns].sort((a, b) => {
		const ai = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER
		const bi = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER
		return ai - bi
	})
}

/** Returns visible columns ordered for rendering: left-pinned, normal, right-pinned. */
function getVisibleColumns(tab: TabGridState): GridColumnDef[] {
	const ordered = getOrderedColumns(tab)
	const visible = ordered.filter(
		(col) => tab.columnConfig[col.name]?.visible !== false,
	)

	const left: GridColumnDef[] = []
	const normal: GridColumnDef[] = []
	const right: GridColumnDef[] = []

	for (const col of visible) {
		const pin = tab.columnConfig[col.name]?.pinned
		if (pin === 'left') left.push(col)
		else if (pin === 'right') right.push(col)
		else normal.push(col)
	}

	return [...left, ...normal, ...right]
}

/** Computes sticky position styles for pinned columns. */
function computePinStyles(
	columns: GridColumnDef[],
	columnConfig: Record<string, ColumnConfig>,
): Map<string, Record<string, string>> {
	const styles = new Map<string, Record<string, string>>()

	// Start after the row number column (40px)
	let leftOffset = 40
	for (const col of columns) {
		if (columnConfig[col.name]?.pinned === 'left') {
			styles.set(col.name, {
				position: 'sticky',
				left: `${leftOffset}px`,
				'z-index': '3',
				background: 'var(--surface-raised)',
			})
			leftOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH
		}
	}

	let rightOffset = 0
	for (let i = columns.length - 1; i >= 0; i--) {
		const col = columns[i]
		if (columnConfig[col.name]?.pinned === 'right') {
			styles.set(col.name, {
				position: 'sticky',
				right: `${rightOffset}px`,
				'z-index': '3',
				background: 'var(--surface-raised)',
			})
			rightOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH
		}
	}

	return styles
}

// ── Editing actions ───────────────────────────────────────

function startEditing(tabId: string, row: number, column: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'editingCell', { row, column })
}

function stopEditing(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'editingCell', null)
}

function setCellValue(tabId: string, rowIndex: number, column: string, newValue: unknown) {
	const tab = ensureTab(tabId)
	const key = `${rowIndex}:${column}`
	const existing = tab.pendingChanges.cellEdits[key]
	const oldValue = existing ? existing.oldValue : tab.rows[rowIndex]?.[column]

	// If reverting to original value, remove the edit
	if (oldValue === newValue) {
		const next = { ...tab.pendingChanges.cellEdits }
		delete next[key]
		setState('tabs', tabId, 'pendingChanges', 'cellEdits', next)
	} else {
		setState('tabs', tabId, 'pendingChanges', 'cellEdits', key, {
			rowIndex,
			column,
			oldValue,
			newValue,
		})
	}

	// Also update the actual row data for display
	setState('tabs', tabId, 'rows', rowIndex, column, newValue)
}

function addNewRow(tabId: string) {
	const tab = ensureTab(tabId)
	const emptyRow: Record<string, unknown> = {}
	for (const col of tab.columns) {
		emptyRow[col.name] = null
	}
	const newIndex = tab.rows.length
	setState('tabs', tabId, 'rows', [...tab.rows, emptyRow])
	const next = new Set(tab.pendingChanges.newRows)
	next.add(newIndex)
	setState('tabs', tabId, 'pendingChanges', 'newRows', next)
	return newIndex
}

/**
 * Paste parsed clipboard data into the grid starting at the given cell.
 * Overwrites existing rows and creates new INSERT rows when pasting beyond the last row.
 * Each pasted cell becomes a pending change (same as inline editing).
 */
function pasteCells(
	tabId: string,
	startRow: number,
	startColumn: string,
	data: unknown[][],
) {
	const tab = ensureTab(tabId)
	const visibleCols = getVisibleColumns(tab)
	const colNames = visibleCols.map((c) => c.name)
	const startColIdx = colNames.indexOf(startColumn)
	if (startColIdx < 0) return

	for (let r = 0; r < data.length; r++) {
		const rowIndex = startRow + r
		// Create new row if we're past the end
		if (rowIndex >= tab.rows.length) {
			addNewRow(tabId)
		}
		const pasteRow = data[r]
		for (let c = 0; c < pasteRow.length; c++) {
			const colIdx = startColIdx + c
			if (colIdx >= colNames.length) break // skip columns beyond visible range
			const colName = colNames[colIdx]
			setCellValue(tabId, rowIndex, colName, pasteRow[c])
		}
	}
}

function deleteSelectedRows(tabId: string) {
	const tab = ensureTab(tabId)
	const selectedIndices = getSelectedRowIndices(tab.selection)
	if (selectedIndices.length === 0) return
	const next = new Set(tab.pendingChanges.deletedRows)

	// Collect new-row indices to remove from the rows array
	const newRowIndicesToRemove: number[] = []

	for (const idx of selectedIndices) {
		if (tab.pendingChanges.newRows.has(idx)) {
			newRowIndicesToRemove.push(idx)
		} else {
			next.add(idx)
		}
	}

	// Remove new rows from rows array (process in reverse to preserve indices)
	if (newRowIndicesToRemove.length > 0) {
		newRowIndicesToRemove.sort((a, b) => b - a)
		for (const idx of newRowIndicesToRemove) {
			// Remove cell edits for this row
			const edits = { ...tab.pendingChanges.cellEdits }
			for (const key of Object.keys(edits)) {
				if (key.startsWith(`${idx}:`)) delete edits[key]
			}
			setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)

			// Remove from newRows
			const nextNew = new Set(tab.pendingChanges.newRows)
			nextNew.delete(idx)
			setState('tabs', tabId, 'pendingChanges', 'newRows', nextNew)

			// Remove row from array
			const filteredRows = tab.rows.filter((_, i) => i !== idx)
			setState('tabs', tabId, 'rows', filteredRows)

			// Adjust indices for remaining pending changes
			adjustIndicesAfterRemoval(tabId, idx)
		}
	}

	setState('tabs', tabId, 'pendingChanges', 'deletedRows', next)
	clearSelection(tabId)
}

function hasPendingChanges(tabId: string): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	return (
		Object.keys(tab.pendingChanges.cellEdits).length > 0
		|| tab.pendingChanges.newRows.size > 0
		|| tab.pendingChanges.deletedRows.size > 0
	)
}

/** Count total number of distinct changes (grouped by type: update rows, inserts, deletes). */
function pendingChangesCount(tabId: string): number {
	const tab = getTab(tabId)
	if (!tab) return 0

	// Count distinct rows with cell edits (excluding new/deleted rows)
	const editedRows = new Set<number>()
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (
			!tab.pendingChanges.newRows.has(edit.rowIndex)
			&& !tab.pendingChanges.deletedRows.has(edit.rowIndex)
		) {
			editedRows.add(edit.rowIndex)
		}
	}

	return editedRows.size + tab.pendingChanges.newRows.size + tab.pendingChanges.deletedRows.size
}

/** Revert all cell edits for a specific existing row (undo UPDATE). */
function revertRowUpdate(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId)
	const edits = { ...tab.pendingChanges.cellEdits }
	for (const [key, edit] of Object.entries(edits)) {
		if (edit.rowIndex === rowIndex) {
			setState('tabs', tabId, 'rows', rowIndex, edit.column, edit.oldValue)
			delete edits[key]
		}
	}
	setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)
}

/** Revert a new row (undo INSERT). */
function revertNewRow(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId)

	// Remove cell edits for this row
	const edits = { ...tab.pendingChanges.cellEdits }
	for (const key of Object.keys(edits)) {
		if (key.startsWith(`${rowIndex}:`)) delete edits[key]
	}
	setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)

	// Remove from newRows
	const nextNew = new Set(tab.pendingChanges.newRows)
	nextNew.delete(rowIndex)
	setState('tabs', tabId, 'pendingChanges', 'newRows', nextNew)

	// Remove the row from rows array and adjust indices in pendingChanges
	const filteredRows = tab.rows.filter((_, i) => i !== rowIndex)
	setState('tabs', tabId, 'rows', filteredRows)

	// Adjust indices for all pending changes that reference rows after the removed one
	adjustIndicesAfterRemoval(tabId, rowIndex)
}

/** Revert a deleted row (undo DELETE). */
function revertDeletedRow(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId)
	const next = new Set(tab.pendingChanges.deletedRows)
	next.delete(rowIndex)
	setState('tabs', tabId, 'pendingChanges', 'deletedRows', next)
}

/** Adjust all pending change indices after a row removal. */
function adjustIndicesAfterRemoval(tabId: string, removedIndex: number) {
	const tab = ensureTab(tabId)

	// Adjust cellEdits keys
	const oldEdits = tab.pendingChanges.cellEdits
	const newEdits: Record<string, CellChange> = {}
	for (const [, edit] of Object.entries(oldEdits)) {
		if (edit.rowIndex > removedIndex) {
			const adjusted = { ...edit, rowIndex: edit.rowIndex - 1 }
			newEdits[`${adjusted.rowIndex}:${adjusted.column}`] = adjusted
		} else {
			newEdits[`${edit.rowIndex}:${edit.column}`] = edit
		}
	}
	setState('tabs', tabId, 'pendingChanges', 'cellEdits', newEdits)

	// Adjust newRows
	const newNewRows = new Set<number>()
	for (const idx of tab.pendingChanges.newRows) {
		newNewRows.add(idx > removedIndex ? idx - 1 : idx)
	}
	setState('tabs', tabId, 'pendingChanges', 'newRows', newNewRows)

	// Adjust deletedRows
	const newDeletedRows = new Set<number>()
	for (const idx of tab.pendingChanges.deletedRows) {
		newDeletedRows.add(idx > removedIndex ? idx - 1 : idx)
	}
	setState('tabs', tabId, 'pendingChanges', 'deletedRows', newDeletedRows)
}

function isCellChanged(tabId: string, rowIndex: number, column: string): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	return `${rowIndex}:${column}` in tab.pendingChanges.cellEdits
}

function isRowNew(tabId: string, rowIndex: number): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	return tab.pendingChanges.newRows.has(rowIndex)
}

function isRowDeleted(tabId: string, rowIndex: number): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	return tab.pendingChanges.deletedRows.has(rowIndex)
}

/**
 * Build DataChange array from pending changes for backend submission.
 */
function buildDataChanges(tabId: string): DataChange[] {
	const tab = ensureTab(tabId)
	const changes: DataChange[] = []
	const pkColumns = tab.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)

	// Collect updates: group cell edits by row
	const editsByRow = new Map<number, Record<string, unknown>>()
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (tab.pendingChanges.newRows.has(edit.rowIndex)) continue // new rows handled separately
		if (tab.pendingChanges.deletedRows.has(edit.rowIndex)) continue // deleted rows handled separately
		let rowEdits = editsByRow.get(edit.rowIndex)
		if (!rowEdits) {
			rowEdits = {}
			editsByRow.set(edit.rowIndex, rowEdits)
		}
		rowEdits[edit.column] = edit.newValue
	}

	for (const [rowIndex, values] of editsByRow) {
		const row = tab.rows[rowIndex]
		const primaryKeys: Record<string, unknown> = {}
		for (const pk of pkColumns) {
			// Use original value if the PK was edited, otherwise current value
			const cellEdit = tab.pendingChanges.cellEdits[`${rowIndex}:${pk}`]
			primaryKeys[pk] = cellEdit ? cellEdit.oldValue : row[pk]
		}
		changes.push({
			type: 'update',
			schema: tab.schema,
			table: tab.table,
			primaryKeys,
			values,
		})
	}

	// Collect inserts (new rows)
	for (const rowIndex of tab.pendingChanges.newRows) {
		const row = tab.rows[rowIndex]
		if (!row) continue
		const values: Record<string, unknown> = {}
		for (const col of tab.columns) {
			if (row[col.name] !== null && row[col.name] !== undefined) {
				values[col.name] = row[col.name]
			}
		}
		changes.push({
			type: 'insert',
			schema: tab.schema,
			table: tab.table,
			values,
		})
	}

	// Collect deletes
	for (const rowIndex of tab.pendingChanges.deletedRows) {
		const row = tab.rows[rowIndex]
		if (!row) continue
		const primaryKeys: Record<string, unknown> = {}
		for (const pk of pkColumns) {
			primaryKeys[pk] = row[pk]
		}
		changes.push({
			type: 'delete',
			schema: tab.schema,
			table: tab.table,
			primaryKeys,
		})
	}

	return changes
}

async function applyChanges(tabId: string, database?: string) {
	const tab = ensureTab(tabId)
	const changes = buildDataChanges(tabId)
	if (changes.length === 0) return

	const dialect = connectionsStore.getDialect(tab.connectionId)
	const statements = changes.map((change) => generateChangeSql(change, dialect))
	const sessionId = sessionStore.getSessionForTab(tabId)
	await rpc.query.execute({ connectionId: tab.connectionId, sql: '', queryId: '', statements, database, sessionId })
}

function generateSqlPreview(tabId: string): string {
	const tab = ensureTab(tabId)
	const changes = buildDataChanges(tabId)
	if (changes.length === 0) return ''
	const dialect = connectionsStore.getDialect(tab.connectionId)
	return generateChangesPreview(changes, dialect)
}

function revertChanges(tabId: string) {
	const tab = ensureTab(tabId)

	// Revert cell edits to original values
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (!tab.pendingChanges.newRows.has(edit.rowIndex)) {
			setState('tabs', tabId, 'rows', edit.rowIndex, edit.column, edit.oldValue)
		}
	}

	// Remove new rows from end
	const newRowIndices = [...tab.pendingChanges.newRows].sort((a, b) => b - a)
	if (newRowIndices.length > 0) {
		const filteredRows = tab.rows.filter((_, i) => !tab.pendingChanges.newRows.has(i))
		setState('tabs', tabId, 'rows', filteredRows)
	}

	// Clear all pending changes
	setState('tabs', tabId, 'pendingChanges', createDefaultPendingChanges())
	setState('tabs', tabId, 'editingCell', null)
}

/** Clear pending changes tracking without reverting cell values (used after successful apply). */
function clearPendingChanges(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'pendingChanges', createDefaultPendingChanges())
	setState('tabs', tabId, 'editingCell', null)
}

// ── Saved view actions ────────────────────────────────────

function setActiveView(tabId: string, viewId: string | null, viewName: string | null) {
	ensureTab(tabId)
	setState('tabs', tabId, 'activeViewId', viewId)
	setState('tabs', tabId, 'activeViewName', viewName)
}

async function applyViewConfig(tabId: string, config: SavedViewConfig) {
	const tab = ensureTab(tabId)

	setState('tabs', tabId, 'sort', config.sort ?? [])

	setState('tabs', tabId, 'filters', config.filters ?? [])
	setState('tabs', tabId, 'customFilter', config.customFilter ?? '')

	if (config.columns) {
		const visibleSet = new Set(config.columns)
		const newConfig: Record<string, ColumnConfig> = {}
		for (const col of tab.columns) {
			newConfig[col.name] = {
				visible: visibleSet.has(col.name),
				width: config.columnWidths?.[col.name],
				pinned: tab.columnConfig[col.name]?.pinned,
			}
		}
		setState('tabs', tabId, 'columnConfig', newConfig)
		setState('tabs', tabId, 'columnOrder', config.columns)
	}

	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

async function resetToDefault(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'sort', [])
	setState('tabs', tabId, 'filters', [])
	setState('tabs', tabId, 'customFilter', '')
	setState('tabs', tabId, 'quickSearch', '')
	setState('tabs', tabId, 'columnConfig', {})
	setState('tabs', tabId, 'columnOrder', [])
	setState('tabs', tabId, 'activeViewId', null)
	setState('tabs', tabId, 'activeViewName', null)
	setState('tabs', tabId, 'currentPage', 1)
	setState('tabs', tabId, 'selection', createDefaultSelection())
	await fetchData(tabId)
}

/** Compare current grid state against a saved view config. Ignores columnWidths to reduce noise. */
function isViewModified(tabId: string, savedConfig: SavedViewConfig): boolean {
	const tab = getTab(tabId)
	if (!tab) return false

	// Compare sort
	const currentSort = tab.sort.map(s => `${s.column}:${s.direction}`).join(',')
	const savedSort = (savedConfig.sort ?? []).map(s => `${s.column}:${s.direction}`).join(',')
	if (currentSort !== savedSort) return true

	// Compare filters
	const currentFilters = tab.filters.map(f => `${f.column}:${f.operator}:${f.value}`).join(',')
	const savedFilters = (savedConfig.filters ?? []).map(f => `${f.column}:${f.operator}:${f.value}`).join(',')
	if (currentFilters !== savedFilters) return true

	// Compare custom filter
	if ((tab.customFilter || '') !== (savedConfig.customFilter || '')) return true

	// Compare visible columns (order matters)
	if (savedConfig.columns) {
		const visibleCols = getVisibleColumns(tab).map(c => c.name)
		if (visibleCols.join(',') !== savedConfig.columns.join(',')) return true
	}

	return false
}

function captureViewConfig(tabId: string): SavedViewConfig {
	const tab = ensureTab(tabId)
	const visible = getVisibleColumns(tab)
	const columnWidths: Record<string, number> = {}
	for (const col of tab.columns) {
		if (tab.columnConfig[col.name]?.width) {
			columnWidths[col.name] = tab.columnConfig[col.name].width!
		}
	}

	return {
		columns: visible.map(c => c.name),
		sort: [...tab.sort],
		filters: [...tab.filters],
		columnWidths: Object.keys(columnWidths).length > 0 ? columnWidths : undefined,
		customFilter: tab.customFilter || undefined,
	}
}

// ── FK Peek popover actions ───────────────────────────────

async function fetchFkRowData(
	connectionId: string,
	schema: string,
	table: string,
	column: string,
	value: unknown,
	database?: string,
): Promise<{ rows: Record<string, unknown>[]; columns: GridColumnDef[]; foreignKeys: ForeignKeyInfo[] }> {
	const dialect = connectionsStore.getDialect(connectionId)
	const filters: ColumnFilter[] = [{ column, operator: 'eq', value: String(value) }]

	const cachedColumns = connectionsStore.getColumns(connectionId, schema, table, database)
	const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
		name: c.name,
		dataType: c.dataType,
		nullable: c.nullable,
		isPrimaryKey: c.isPrimaryKey,
	}))

	const selectQuery = buildSelectQuery(schema, table, 1, 50, undefined, filters, dialect)
	const results = await rpc.query.execute({
		connectionId,
		sql: selectQuery.sql,
		queryId: `fk-peek-${schema}-${table}-${column}`,
		params: selectQuery.params,
		database,
	})

	const foreignKeys = connectionsStore.getForeignKeys(connectionId, schema, table, database)

	return {
		rows: results[0]?.rows ?? [],
		columns: gridColumns,
		foreignKeys,
	}
}

async function openFkPeek(
	tabId: string,
	anchorRect: { top: number; left: number; bottom: number; right: number },
	schema: string,
	table: string,
	column: string,
	value: unknown,
) {
	const tab = ensureTab(tabId)

	setState('tabs', tabId, 'fkPeek', {
		anchorRect,
		rows: [],
		columns: [],
		breadcrumbs: [],
		foreignKeys: [],
		schema,
		table,
		loading: true,
	})

	try {
		const data = await fetchFkRowData(tab.connectionId, schema, table, column, value, tab.database)
		// Check peek is still open (user might have closed it)
		if (!state.tabs[tabId]?.fkPeek) return
		setState('tabs', tabId, 'fkPeek', {
			anchorRect,
			rows: data.rows,
			columns: data.columns,
			breadcrumbs: [{ schema, table, column, value }],
			foreignKeys: data.foreignKeys,
			schema,
			table,
			loading: false,
		})
	} catch {
		setState('tabs', tabId, 'fkPeek', null)
	}
}

function closeFkPeek(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'fkPeek', null)
}

async function fkPeekNavigate(
	tabId: string,
	schema: string,
	table: string,
	column: string,
	value: unknown,
) {
	const tab = ensureTab(tabId)
	const peek = tab.fkPeek
	if (!peek) return

	const newBreadcrumbs = [...peek.breadcrumbs, { schema, table, column, value }]
	setState('tabs', tabId, 'fkPeek', {
		...peek,
		loading: true,
		breadcrumbs: newBreadcrumbs,
	})

	try {
		const data = await fetchFkRowData(tab.connectionId, schema, table, column, value, tab.database)
		if (!state.tabs[tabId]?.fkPeek) return
		setState('tabs', tabId, 'fkPeek', {
			anchorRect: peek.anchorRect,
			rows: data.rows,
			columns: data.columns,
			breadcrumbs: newBreadcrumbs,
			foreignKeys: data.foreignKeys,
			schema,
			table,
			loading: false,
		})
	} catch {
		setState('tabs', tabId, 'fkPeek', null)
	}
}

function fkPeekBack(tabId: string) {
	const tab = ensureTab(tabId)
	const peek = tab.fkPeek
	if (!peek || peek.breadcrumbs.length <= 1) return

	const prevBreadcrumbs = peek.breadcrumbs.slice(0, -1)
	const prev = prevBreadcrumbs[prevBreadcrumbs.length - 1]

	// Re-fetch the previous breadcrumb's data
	setState('tabs', tabId, 'fkPeek', {
		...peek,
		loading: true,
		breadcrumbs: prevBreadcrumbs,
	})

	fetchFkRowData(tab.connectionId, prev.schema, prev.table, prev.column, prev.value, tab.database)
		.then((data) => {
			if (!state.tabs[tabId]?.fkPeek) return
			setState('tabs', tabId, 'fkPeek', {
				anchorRect: peek.anchorRect,
				rows: data.rows,
				columns: data.columns,
				breadcrumbs: prevBreadcrumbs,
				foreignKeys: data.foreignKeys,
				schema: prev.schema,
				table: prev.table,
				loading: false,
			})
		})
		.catch(() => {
			setState('tabs', tabId, 'fkPeek', null)
		})
}

// ── FK Exploration panel actions ──────────────────────────

async function openFkPanel(
	tabId: string,
	schema: string,
	table: string,
	filters: ColumnFilter[],
) {
	const tab = ensureTab(tabId)

	// Close value editor if open (mutually exclusive)
	if (tab.valueEditorOpen) {
		setState('tabs', tabId, 'valueEditorOpen', false)
	}
	// Close peek if open
	setState('tabs', tabId, 'fkPeek', null)

	const breadcrumb: FkBreadcrumb = {
		schema,
		table,
		column: filters[0]?.column ?? '',
		value: filters[0]?.value,
	}

	setState('tabs', tabId, 'fkPanel', {
		width: tab.fkPanel?.width ?? 500,
		schema,
		table,
		filters,
		rows: [],
		columns: [],
		breadcrumbs: [breadcrumb],
		foreignKeys: [],
		totalCount: 0,
		currentPage: 1,
		pageSize: 100,
		loading: true,
	})

	await fetchFkPanelData(tabId)
}

async function fetchFkPanelData(tabId: string) {
	const tab = ensureTab(tabId)
	const panel = tab.fkPanel
	if (!panel) return

	try {
		const dialect = connectionsStore.getDialect(tab.connectionId)
		const cachedColumns = connectionsStore.getColumns(tab.connectionId, panel.schema, panel.table, tab.database)
		const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
			name: c.name,
			dataType: c.dataType,
			nullable: c.nullable,
			isPrimaryKey: c.isPrimaryKey,
		}))

		const filters = panel.filters.length > 0 ? panel.filters : undefined
		const selectQuery = buildSelectQuery(panel.schema, panel.table, panel.currentPage, panel.pageSize, undefined, filters, dialect)
		const countQuery = buildCountQuery(panel.schema, panel.table, filters, dialect)

		const [dataResults, countResults] = await Promise.all([
			rpc.query.execute({
				connectionId: tab.connectionId,
				sql: selectQuery.sql,
				queryId: `fk-panel-${tabId}`,
				params: selectQuery.params,
				database: tab.database,
			}),
			rpc.query.execute({
				connectionId: tab.connectionId,
				sql: countQuery.sql,
				queryId: `fk-panel-count-${tabId}`,
				params: countQuery.params,
				database: tab.database,
			}),
		])

		if (!state.tabs[tabId]?.fkPanel) return
		const foreignKeys = connectionsStore.getForeignKeys(tab.connectionId, panel.schema, panel.table, tab.database)

		setState('tabs', tabId, 'fkPanel', {
			...panel,
			rows: dataResults[0]?.rows ?? [],
			columns: gridColumns,
			totalCount: Number(countResults[0]?.rows[0]?.count ?? 0),
			foreignKeys,
			loading: false,
		})
	} catch {
		setState('tabs', tabId, 'fkPanel', null)
	}
}

function closeFkPanel(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'fkPanel', null)
}

async function fkPanelNavigate(
	tabId: string,
	schema: string,
	table: string,
	column: string,
	value: unknown,
) {
	const tab = ensureTab(tabId)
	const panel = tab.fkPanel
	if (!panel) return

	const newFilters: ColumnFilter[] = [{ column, operator: 'eq', value: String(value) }]
	const newBreadcrumbs = [...panel.breadcrumbs, { schema, table, column, value }]

	setState('tabs', tabId, 'fkPanel', {
		...panel,
		schema,
		table,
		filters: newFilters,
		breadcrumbs: newBreadcrumbs,
		currentPage: 1,
		loading: true,
	})

	await fetchFkPanelData(tabId)
}

async function fkPanelBack(tabId: string) {
	const tab = ensureTab(tabId)
	const panel = tab.fkPanel
	if (!panel || panel.breadcrumbs.length <= 1) return

	const prevBreadcrumbs = panel.breadcrumbs.slice(0, -1)
	const prev = prevBreadcrumbs[prevBreadcrumbs.length - 1]

	setState('tabs', tabId, 'fkPanel', {
		...panel,
		schema: prev.schema,
		table: prev.table,
		filters: [{ column: prev.column, operator: 'eq', value: String(prev.value) }],
		breadcrumbs: prevBreadcrumbs,
		currentPage: 1,
		loading: true,
	})

	await fetchFkPanelData(tabId)
}

function fkPanelResize(tabId: string, width: number) {
	const tab = ensureTab(tabId)
	if (!tab.fkPanel) return
	setState('tabs', tabId, 'fkPanel', 'width', Math.min(1200, Math.max(250, width)))
}

async function fkPanelSetPage(tabId: string, page: number) {
	const tab = ensureTab(tabId)
	if (!tab.fkPanel) return
	setState('tabs', tabId, 'fkPanel', 'currentPage', page)
	setState('tabs', tabId, 'fkPanel', 'loading', true)
	await fetchFkPanelData(tabId)
}

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
	setState('tabs', tabId, 'valueEditorWidth', Math.min(800, Math.max(200, width)))
}

// ── Heatmap actions ───────────────────────────────────────

function setHeatmap(tabId: string, column: string, mode: HeatmapMode) {
	const tab = ensureTab(tabId)
	// Only allow heatmaps on numeric columns
	const col = tab.columns.find((c) => c.name === column)
	if (!col || !isNumericType(col.dataType)) return
	setState('tabs', tabId, 'heatmapColumns', { ...tab.heatmapColumns, [column]: mode })
}

function removeHeatmap(tabId: string, column: string) {
	const tab = ensureTab(tabId)
	const next = { ...tab.heatmapColumns }
	delete next[column]
	setState('tabs', tabId, 'heatmapColumns', next)
}

/** Compute min/max stats for all heatmap columns from currently displayed rows. */
function computeHeatmapStats(tab: TabGridState): Map<string, HeatmapInfo> {
	const result = new Map<string, HeatmapInfo>()
	const columns = Object.keys(tab.heatmapColumns)
	if (columns.length === 0) return result

	for (const colName of columns) {
		const mode = tab.heatmapColumns[colName]
		let min = Infinity
		let max = -Infinity
		for (const row of tab.rows) {
			const val = row[colName]
			if (val === null || val === undefined) continue
			const num = Number(val)
			if (Number.isNaN(num)) continue
			if (num < min) min = num
			if (num > max) max = num
		}
		if (min <= max) {
			result.set(colName, { min, max, mode })
		}
	}
	return result
}

/** Compute a CSS background color for a heatmap cell. */
function computeHeatmapColor(value: unknown, info: HeatmapInfo): string | undefined {
	if (value === null || value === undefined) return undefined
	const num = Number(value)
	if (Number.isNaN(num)) return undefined

	const range = info.max - info.min
	const t = range === 0 ? 0.5 : (num - info.min) / range // 0..1

	if (info.mode === 'sequential') {
		// Blue scale: low opacity → high opacity
		const alpha = 0.08 + t * 0.47 // 0.08..0.55
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	// Diverging: blue (0) → transparent (0.5) → red (1)
	if (t < 0.5) {
		const alpha = (1 - t * 2) * 0.5 // 0.5→0
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	const alpha = (t * 2 - 1) * 0.5 // 0→0.5
	return `rgba(239, 68, 68, ${alpha.toFixed(3)})`
}

function removeTab(tabId: string) {
	latestFetchId.delete(tabId)
	setState('tabs', tabId, undefined!)
}

// ── Aggregate selection data ──────────────────────────────

/** Return selected rows data and columns for aggregate computation. */
function getSelectedCellData(tabId: string): { rows: Record<string, unknown>[]; columns: GridColumnDef[] } | null {
	const tab = getTab(tabId)
	if (!tab) return null
	const indices = getSelectedRowIndices(tab.selection)
	if (indices.length < 2) return null
	const rows = indices.filter((i) => tab.rows[i] != null).map((i) => tab.rows[i])
	return { rows, columns: tab.columns }
}

// ── Export ────────────────────────────────────────────────

export const gridStore = {
	getTab,

	loadTableData,
	refreshData,
	setPage,
	setPageSize,
	toggleSort,
	setFilter,
	removeFilter,
	clearFilters,
	setCustomFilter,
	setQuickSearch,
	selectCell,
	extendSelection,
	addCellRange,
	selectFullRow,
	selectFullRowRange,
	toggleFullRow,
	selectFullColumn,
	selectAll,
	moveFocus,
	extendFocus,
	clearSelection,
	getSelectedData,
	setFocusedCell,
	buildClipboardTsv,
	buildAdvancedCopyText,
	formatCellForClipboard,
	setColumnWidth,
	setColumnVisibility,
	setColumnPinned,
	setColumnOrder,
	resetColumnConfig,
	getOrderedColumns,
	getVisibleColumns,
	computePinStyles,
	removeTab,

	// Heatmap
	setHeatmap,
	removeHeatmap,
	computeHeatmapStats,
	computeHeatmapColor,

	// Transpose
	toggleTranspose,

	// Value editor
	toggleValueEditor,
	setValueEditorWidth,

	// FK peek popover
	openFkPeek,
	closeFkPeek,
	fkPeekNavigate,
	fkPeekBack,

	// FK exploration panel
	openFkPanel,
	closeFkPanel,
	fkPanelNavigate,
	fkPanelBack,
	fkPanelResize,
	fkPanelSetPage,

	// Saved views
	setActiveView,
	applyViewConfig,
	resetToDefault,
	captureViewConfig,
	isViewModified,

	// Aggregation
	getSelectedCellData,

	// Editing
	startEditing,
	stopEditing,
	setCellValue,
	addNewRow,
	pasteCells,
	deleteSelectedRows,
	hasPendingChanges,
	pendingChangesCount,
	isCellChanged,
	isRowNew,
	isRowDeleted,
	buildDataChanges,
	applyChanges,
	generateSqlPreview,
	revertChanges,
	clearPendingChanges,
	revertRowUpdate,
	revertNewRow,
	revertDeletedRow,
}
