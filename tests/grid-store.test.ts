import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { GridDataResponse } from '../src/shared/types/grid'

// ── Mock solid-js/store ──────────────────────────────────

let storeState: any

mock.module('solid-js/store', () => ({
	createStore: (initial: any) => {
		storeState = structuredClone(initial)

		const setStore = (...args: any[]) => {
			if (args.length === 3) {
				// setState("tabs", tabId, value) or setState("tabs", tabId, undefined)
				const [key, subKey, value] = args
				if (value === undefined) {
					delete storeState[key][subKey]
				} else if (typeof value === 'object' && value !== null && !(value instanceof Set)) {
					// Merge object into existing
					storeState[key][subKey] = { ...storeState[key]?.[subKey], ...value }
				} else {
					if (!storeState[key]) storeState[key] = {}
					storeState[key][subKey] = value
				}
			} else if (args.length === 4) {
				// setState("tabs", tabId, "field", value)
				const [key, subKey, field, value] = args
				if (typeof value === 'function') {
					storeState[key][subKey][field] = value(storeState[key][subKey][field])
				} else {
					storeState[key][subKey][field] = value
				}
			} else if (args.length === 5) {
				// setState("tabs", tabId, "nested", "subField", value)
				const [key, subKey, field, subField, value] = args
				if (!storeState[key][subKey][field]) storeState[key][subKey][field] = {}
				storeState[key][subKey][field][subField] = value
			} else if (args.length === 6) {
				// setState("tabs", tabId, "nested", index/key, "subField", value)
				const [key, subKey, field, index, subField, value] = args
				if (!storeState[key][subKey][field]) storeState[key][subKey][field] = {}
				if (storeState[key][subKey][field][index] === undefined) {
					storeState[key][subKey][field][index] = {}
				}
				if (typeof storeState[key][subKey][field][index] === 'object' && storeState[key][subKey][field][index] !== null) {
					storeState[key][subKey][field][index][subField] = value
				}
			}
		}

		return [storeState, setStore]
	},
}))

// ── Mock RPC ─────────────────────────────────────────────

let mockQueryExecute: ReturnType<typeof mock>

// Default test data
const defaultColumns = [
	{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, isAutoIncrement: false, defaultValue: null },
	{ name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, isAutoIncrement: false, defaultValue: null },
]
const defaultRows = [
	{ id: 1, name: 'Alice' },
	{ id: 2, name: 'Bob' },
	{ id: 3, name: 'Charlie' },
]
const defaultTotalRows = 50

function makeQueryResult(rows: Record<string, unknown>[], rowCount?: number) {
	return [{ columns: [], rows, rowCount: rowCount ?? rows.length }]
}

function defaultQueryExecuteImpl(params: { connectionId: string; sql: string; queryId: string; params?: unknown[]; database?: string }) {
	// Count queries return totalRows
	if (params.sql.trimStart().toUpperCase().startsWith('SELECT COUNT(')) {
		return Promise.resolve(makeQueryResult([{ count: defaultTotalRows }]))
	}
	// Data queries return fresh copies of rows (to avoid cross-test mutation)
	return Promise.resolve(makeQueryResult(defaultRows.map((r) => ({ ...r }))))
}

mock.module('../src/frontend-shared/lib/rpc', () => {
	mockQueryExecute = mock(defaultQueryExecuteImpl)

	return {
		rpc: {
			query: {
				execute: (...args: any[]) => mockQueryExecute(...args),
			},
		},
		messages: {
			onConnectionStatusChanged: () => () => {},
			onMenuAction: () => () => {},
		},
		friendlyErrorMessage: (err: unknown) => String(err),
	}
})

// ── Mock settings store (needed by grid store) ───────────
mock.module('../src/frontend-shared/stores/settings', () => ({
	settingsStore: {
		get gridConfig() {
			return { autoCount: false }
		},
	},
}))

// ── Mock connections store (needed by grid store) ────────
mock.module('../src/frontend-shared/stores/connections', () => ({
	connectionsStore: {
		connections: [],
		getDialect: () => ({
			quoteIdentifier: (name: string) => `"${name}"`,
			qualifyTable: (schema: string, table: string) => `"${schema}"."${table}"`,
			emptyInsertSql: (qt: string) => `INSERT INTO ${qt} DEFAULT VALUES`,
			getDriverType: () => 'sqlite' as const,
			placeholder: (index: number) => `$${index}`,
		}),
		getColumns: () => defaultColumns,
		getSchemaData: () => undefined,
		getConnectionType: () => 'sqlite',
	},
}))

// ── Import after mocks ───────────────────────────────────

const { gridStore } = await import('../src/frontend-shared/stores/grid')

// ── Test helpers ─────────────────────────────────────────

function makeResponse(overrides?: Partial<GridDataResponse>): GridDataResponse {
	return {
		columns: [
			{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
			{ name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false },
		],
		rows: defaultRows,
		totalRows: defaultTotalRows,
		page: 1,
		pageSize: 100,
		...overrides,
	}
}

function resetState() {
	storeState.tabs = {}
	mockQueryExecute.mockReset()
	mockQueryExecute.mockImplementation(defaultQueryExecuteImpl)
}

// ── Tests ────────────────────────────────────────────────

describe('grid store', () => {
	beforeEach(() => {
		resetState()
	})

	describe('loadTableData', () => {
		test('creates tab state and loads data via RPC', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const tab = gridStore.getTab('tab-1')
			expect(tab).toBeDefined()
			expect(tab!.connectionId).toBe('conn-1')
			expect(tab!.schema).toBe('public')
			expect(tab!.table).toBe('users')
			expect(tab!.columns).toHaveLength(2)
			expect(tab!.rows).toHaveLength(3)
			// totalCount is null by default (autoCount: false)
			expect(tab!.totalCount).toBeNull()
			expect(tab!.loading).toBe(false)

			// 1 call per fetch: data query only (no auto-count)
			expect(mockQueryExecute).toHaveBeenCalledTimes(1)
			expect(mockQueryExecute.mock.calls[0][0].connectionId).toBe('conn-1')
		})

		test('reuses existing tab state on subsequent calls', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			// 1 call per fetch × 2 fetches = 2
			expect(mockQueryExecute).toHaveBeenCalledTimes(2)
			// Tab should still exist
			expect(gridStore.getTab('tab-1')).toBeDefined()
		})
	})

	describe('per-tab isolation', () => {
		test('each tab has independent state', async () => {
			// Use custom impl that returns different data per connectionId.
			mockQueryExecute.mockImplementation((params: any) => {
				if (params.connectionId === 'conn-1') return Promise.resolve(makeQueryResult([{ id: 1, name: 'Alice' }]))
				return Promise.resolve(makeQueryResult([{ id: 100, name: 'Zara' }]))
			})

			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.loadTableData('tab-2', 'conn-2', 'mydb', 'orders')

			const tab1 = gridStore.getTab('tab-1')!
			const tab2 = gridStore.getTab('tab-2')!

			expect(tab1.connectionId).toBe('conn-1')
			expect(tab1.table).toBe('users')
			// totalCount is null (autoCount: false)
			expect(tab1.totalCount).toBeNull()

			expect(tab2.connectionId).toBe('conn-2')
			expect(tab2.table).toBe('orders')
			expect(tab2.totalCount).toBeNull()
		})

		test('modifying one tab does not affect another', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.loadTableData('tab-2', 'conn-2', 'main', 'items')

			gridStore.selectAll('tab-1', 3, 2)
			expect(gridStore.getTab('tab-1')!.selection.ranges.length).toBe(1)
			expect(gridStore.getTab('tab-2')!.selection.ranges.length).toBe(0)
		})
	})

	describe('pagination', () => {
		test('setPage updates page and reloads data', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setPage('tab-1', 2)

			// 2 fetches × 1 call each = 2
			expect(mockQueryExecute).toHaveBeenCalledTimes(2)
			expect(gridStore.getTab('tab-1')!.currentPage).toBe(2)
		})

		test('setPage clears row selection', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.selectAll('tab-1', 3, 2)
			expect(gridStore.getTab('tab-1')!.selection.ranges.length).toBe(1)

			await gridStore.setPage('tab-1', 2)
			expect(gridStore.getTab('tab-1')!.selection.ranges.length).toBe(0)
		})

		test('setPageSize updates page size and resets to page 1', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.setPage('tab-1', 2)
			await gridStore.setPageSize('tab-1', 50)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.pageSize).toBe(50)
			expect(tab.currentPage).toBe(1)
		})

		test('setPageSize clears row selection', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.selectAll('tab-1', 3, 2)
			expect(gridStore.getTab('tab-1')!.selection.ranges.length).toBe(1)

			await gridStore.setPageSize('tab-1', 25)
			expect(gridStore.getTab('tab-1')!.selection.ranges.length).toBe(0)
		})

		test('setPageSize sends correct page size', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setPageSize('tab-1', 250)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.pageSize).toBe(250)
			expect(tab.currentPage).toBe(1)
		})
	})

	describe('sorting', () => {
		test('toggleSort adds ascending sort on first click', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.toggleSort('tab-1', 'name')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.sort).toEqual([{ column: 'name', direction: 'asc' }])
			// 2 fetches × 1 call each = 2
			expect(mockQueryExecute).toHaveBeenCalledTimes(2)
		})

		test('toggleSort changes to descending on second click', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.toggleSort('tab-1', 'name')
			await gridStore.toggleSort('tab-1', 'name')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.sort).toEqual([{ column: 'name', direction: 'desc' }])
		})

		test('toggleSort removes sort on third click', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.toggleSort('tab-1', 'name')
			await gridStore.toggleSort('tab-1', 'name')
			await gridStore.toggleSort('tab-1', 'name')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.sort).toEqual([])
		})

		test('toggleSort resets to page 1', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.setPage('tab-1', 2)
			await gridStore.toggleSort('tab-1', 'name')

			expect(gridStore.getTab('tab-1')!.currentPage).toBe(1)
		})

		test('toggleSort updates sort state', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.toggleSort('tab-1', 'id')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.sort).toEqual([{ column: 'id', direction: 'asc' }])
		})
	})

	describe('filtering', () => {
		test('setFilter adds a new filter and reloads', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setFilter('tab-1', {
				column: 'name',
				operator: 'eq',
				value: 'Alice',
			})

			const tab = gridStore.getTab('tab-1')!
			expect(tab.filters).toHaveLength(1)
			expect(tab.filters[0]).toEqual({
				column: 'name',
				operator: 'eq',
				value: 'Alice',
			})
			// 2 fetches × 1 call each = 2
			expect(mockQueryExecute).toHaveBeenCalledTimes(2)
		})

		test('setFilter updates existing filter for same column', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setFilter('tab-1', {
				column: 'name',
				operator: 'eq',
				value: 'Alice',
			})
			await gridStore.setFilter('tab-1', {
				column: 'name',
				operator: 'like',
				value: '%ob%',
			})

			const tab = gridStore.getTab('tab-1')!
			expect(tab.filters).toHaveLength(1)
			expect(tab.filters[0].operator).toBe('like')
			expect(tab.filters[0].value).toBe('%ob%')
		})

		test('setFilter resets to page 1', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			await gridStore.setPage('tab-1', 2)

			await gridStore.setFilter('tab-1', {
				column: 'id',
				operator: 'gt',
				value: 5,
			})

			expect(gridStore.getTab('tab-1')!.currentPage).toBe(1)
		})

		test('clearFilters removes all filters and reloads', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setFilter('tab-1', { column: 'name', operator: 'eq', value: 'Alice' })
			await gridStore.setFilter('tab-1', { column: 'id', operator: 'gt', value: 5 })

			await gridStore.clearFilters('tab-1')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.filters).toHaveLength(0)
		})

		test('setFilter updates filter state', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			await gridStore.setFilter('tab-1', {
				column: 'name',
				operator: 'eq',
				value: 'Alice',
			})

			const tab = gridStore.getTab('tab-1')!
			expect(tab.filters).toEqual([
				{ column: 'name', operator: 'eq', value: 'Alice' },
			])
		})
	})

	describe('cell selection', () => {
		test('selectCell selects a single cell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 0)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.selection.focusedCell).toEqual({ row: 0, col: 0 })
			expect(tab.selection.ranges).toHaveLength(1)
			expect(tab.selection.ranges[0]).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
		})

		test('selectCell replaces previous selection', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 0)
			gridStore.selectCell('tab-1', 1, 1)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.selection.ranges).toHaveLength(1)
			expect(tab.selection.focusedCell).toEqual({ row: 1, col: 1 })
		})

		test('selectFullRow selects entire row', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 0, 2)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.selection.ranges).toHaveLength(1)
			expect(tab.selection.ranges[0]).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })
			expect(tab.selection.selectMode).toBe('rows')
		})

		test('selectFullRowRange selects range of rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.selectFullRowRange('tab-1', 0, 2, 2)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.selection.ranges).toHaveLength(1)
			expect(tab.selection.ranges[0]).toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 })
		})

		test('selectAll selects all cells', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectAll('tab-1', 3, 2)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.selection.ranges).toHaveLength(1)
			expect(tab.selection.ranges[0]).toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 })
		})

		test('getSelectedData returns data for selected rows in order', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.selectFullRowRange('tab-1', 0, 1, 2)
			const data = gridStore.getSelectedData('tab-1')

			expect(data).toHaveLength(2)
			expect(data[0]).toEqual({ id: 1, name: 'Alice' })
			expect(data[1]).toEqual({ id: 2, name: 'Bob' })
		})
	})

	describe('removeTab', () => {
		test('removes tab state', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.removeTab('tab-1')
			expect(gridStore.getTab('tab-1')).toBeUndefined()
		})
	})

	describe('clipboard / TSV export', () => {
		test('formatCellForClipboard handles null and undefined', () => {
			expect(gridStore.formatCellForClipboard(null)).toBe('')
			expect(gridStore.formatCellForClipboard(undefined)).toBe('')
		})

		test('formatCellForClipboard handles strings', () => {
			expect(gridStore.formatCellForClipboard('hello')).toBe('hello')
		})

		test('formatCellForClipboard handles numbers and booleans', () => {
			expect(gridStore.formatCellForClipboard(42)).toBe('42')
			expect(gridStore.formatCellForClipboard(true)).toBe('true')
		})

		test('formatCellForClipboard serializes objects as JSON', () => {
			expect(gridStore.formatCellForClipboard({ a: 1 })).toBe('{"a":1}')
		})

		test('formatCellForClipboard strips tabs and newlines from strings', () => {
			expect(gridStore.formatCellForClipboard('a\tb\nc')).toBe('a b c')
		})

		test('buildClipboardTsv returns null when no rows selected', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result).toBeNull()
		})

		test('buildClipboardTsv copies single cell when single cell selected', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 1) // col 1 = 'name'

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result).not.toBeNull()
			expect(result!.text).toBe('Alice')
			expect(result!.rowCount).toBe(0)
		})

		test('buildClipboardTsv copies single cell with NULL as empty string', async () => {
			mockQueryExecute.mockImplementation((params: any) => {
				if (params.sql.trimStart().toUpperCase().startsWith('SELECT COUNT(')) {
					return Promise.resolve(makeQueryResult([{ count: 1 }]))
				}
				return Promise.resolve(makeQueryResult([{ id: 1, name: null }]))
			})
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 1) // col 1 = 'name'

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result!.text).toBe('')
		})

		test('buildClipboardTsv copies multiple rows as TSV with header', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectAll('tab-1', 3, 2)

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result).not.toBeNull()
			expect(result!.rowCount).toBe(3)

			const lines = result!.text.split('\n')
			expect(lines).toHaveLength(4) // header + 3 rows
			expect(lines[0]).toBe('id\tname')
			expect(lines[1]).toBe('1\tAlice')
			expect(lines[2]).toBe('2\tBob')
			expect(lines[3]).toBe('3\tCharlie')
		})

		test('buildClipboardTsv copies full row as TSV with header', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 1, 2)

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result).not.toBeNull()
			expect(result!.rowCount).toBe(1)

			const lines = result!.text.split('\n')
			expect(lines).toHaveLength(2) // header + 1 row
			expect(lines[0]).toBe('id\tname')
			expect(lines[1]).toBe('2\tBob')
		})

		test('buildClipboardTsv multi-row selection copies all columns', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.selectFullRowRange('tab-1', 0, 1, 2)

			const tab = gridStore.getTab('tab-1')!
			const cols = gridStore.getVisibleColumns(tab)
			const result = gridStore.buildClipboardTsv('tab-1', cols)

			expect(result!.rowCount).toBe(2)
		})
	})

	describe('focusedCell', () => {
		test('selectCell sets focused cell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 1)
			expect(gridStore.getTab('tab-1')!.selection.focusedCell).toEqual({ row: 0, col: 1 })
		})

		test('clearSelection clears focusedCell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 1)
			gridStore.clearSelection('tab-1')

			expect(gridStore.getTab('tab-1')!.selection.focusedCell).toBeNull()
		})

		test('setFocusedCell with null clears focused cell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectCell('tab-1', 0, 1)
			gridStore.setFocusedCell('tab-1', null)

			expect(gridStore.getTab('tab-1')!.selection.focusedCell).toBeNull()
		})
	})

	describe('error handling', () => {
		test('throws for operations on non-existent tabs', () => {
			expect(() => gridStore.selectCell('nonexistent', 0, 0)).toThrow(
				'Grid state not found for tab nonexistent',
			)
		})

		test('loading remains false after RPC error', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			mockQueryExecute.mockImplementation(() => Promise.reject(new Error('Connection lost')))

			await expect(gridStore.setPage('tab-1', 2)).rejects.toThrow('Connection lost')
			expect(gridStore.getTab('tab-1')!.loading).toBe(false)
		})
	})

	describe('inline editing', () => {
		test('startEditing sets editingCell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.startEditing('tab-1', 0, 'name')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.editingCell).toEqual({ row: 0, column: 'name' })
		})

		test('stopEditing clears editingCell', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.startEditing('tab-1', 0, 'name')
			gridStore.stopEditing('tab-1')

			expect(gridStore.getTab('tab-1')!.editingCell).toBeNull()
		})

		test('setCellValue adds to pendingChanges and updates row data', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.pendingChanges.cellEdits['0:name']).toEqual({
				rowIndex: 0,
				column: 'name',
				oldValue: 'Alice',
				newValue: 'Updated',
			})
			expect(tab.rows[0].name).toBe('Updated')
		})

		test('setCellValue removes edit when reverting to original value', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			expect(gridStore.isCellChanged('tab-1', 0, 'name')).toBe(true)

			gridStore.setCellValue('tab-1', 0, 'name', 'Alice')
			expect(gridStore.isCellChanged('tab-1', 0, 'name')).toBe(false)
		})

		test('isCellChanged returns correct state', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			expect(gridStore.isCellChanged('tab-1', 0, 'name')).toBe(false)

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			expect(gridStore.isCellChanged('tab-1', 0, 'name')).toBe(true)
			expect(gridStore.isCellChanged('tab-1', 0, 'id')).toBe(false)
		})

		test('addNewRow adds empty row and marks as new', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const newIndex = gridStore.addNewRow('tab-1')

			const tab = gridStore.getTab('tab-1')!
			expect(newIndex).toBe(3)
			expect(tab.rows).toHaveLength(4)
			expect(tab.rows[3]).toEqual({ id: null, name: null })
			expect(tab.pendingChanges.newRows.has(3)).toBe(true)
			expect(gridStore.isRowNew('tab-1', 3)).toBe(true)
		})

		test('deleteSelectedRows marks rows as deleted', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 1, 2)
			gridStore.deleteSelectedRows('tab-1')

			expect(gridStore.isRowDeleted('tab-1', 1)).toBe(true)
			expect(gridStore.isRowDeleted('tab-1', 0)).toBe(false)
		})

		test('deleteSelectedRows removes new rows instead of marking deleted', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const newIndex = gridStore.addNewRow('tab-1')
			gridStore.selectFullRow('tab-1', newIndex, 2)
			gridStore.deleteSelectedRows('tab-1')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.pendingChanges.newRows.has(newIndex)).toBe(false)
			expect(tab.pendingChanges.deletedRows.has(newIndex)).toBe(false)
		})

		test('hasPendingChanges returns true when changes exist', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			expect(gridStore.hasPendingChanges('tab-1')).toBe(false)

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			expect(gridStore.hasPendingChanges('tab-1')).toBe(true)
		})

		test('buildDataChanges generates update changes', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')

			const changes = gridStore.buildDataChanges('tab-1')
			expect(changes).toHaveLength(1)
			expect(changes[0]).toEqual({
				type: 'update',
				schema: 'public',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { name: 'Updated' },
			})
		})

		test('buildDataChanges generates insert changes for new rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const newIndex = gridStore.addNewRow('tab-1')
			gridStore.setCellValue('tab-1', newIndex, 'name', 'David')

			const changes = gridStore.buildDataChanges('tab-1')
			const inserts = changes.filter((c) => c.type === 'insert')
			expect(inserts).toHaveLength(1)
			expect(inserts[0].values).toEqual({ name: 'David' })
		})

		test('buildDataChanges generates delete changes', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.selectFullRow('tab-1', 2, 2)
			gridStore.deleteSelectedRows('tab-1')

			const changes = gridStore.buildDataChanges('tab-1')
			const deletes = changes.filter((c) => c.type === 'delete')
			expect(deletes).toHaveLength(1)
			expect(deletes[0]).toEqual({
				type: 'delete',
				schema: 'public',
				table: 'users',
				primaryKeys: { id: 3 },
			})
		})

		test('revertChanges restores original values', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			expect(gridStore.getTab('tab-1')!.rows[0].name).toBe('Updated')

			gridStore.revertChanges('tab-1')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.rows[0].name).toBe('Alice')
			expect(Object.keys(tab.pendingChanges.cellEdits)).toHaveLength(0)
			expect(tab.pendingChanges.newRows.size).toBe(0)
			expect(tab.pendingChanges.deletedRows.size).toBe(0)
			expect(tab.editingCell).toBeNull()
		})

		test('revertChanges removes new rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			gridStore.addNewRow('tab-1')
			expect(gridStore.getTab('tab-1')!.rows).toHaveLength(4)

			gridStore.revertChanges('tab-1')

			expect(gridStore.getTab('tab-1')!.rows).toHaveLength(3)
		})

		test('initial state has empty pendingChanges', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')

			const tab = gridStore.getTab('tab-1')!
			expect(tab.editingCell).toBeNull()
			expect(tab.pendingChanges).toBeDefined()
			expect(Object.keys(tab.pendingChanges.cellEdits)).toHaveLength(0)
			expect(tab.pendingChanges.newRows.size).toBe(0)
			expect(tab.pendingChanges.deletedRows.size).toBe(0)
		})
	})

	describe('pendingChangesCount', () => {
		test('returns 0 when no changes', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			expect(gridStore.pendingChangesCount('tab-1')).toBe(0)
		})

		test('counts updated rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			gridStore.setCellValue('tab-1', 0, 'email', 'new@test.com')
			gridStore.setCellValue('tab-1', 1, 'name', 'Also Updated')
			// Two rows with edits, but multiple edits on row 0 count as 1
			expect(gridStore.pendingChangesCount('tab-1')).toBe(2)
		})

		test('counts new rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.addNewRow('tab-1')
			gridStore.addNewRow('tab-1')
			expect(gridStore.pendingChangesCount('tab-1')).toBe(2)
		})

		test('counts deleted rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.deleteSelectedRows('tab-1')
			expect(gridStore.pendingChangesCount('tab-1')).toBe(1)
		})

		test('counts all types together', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			gridStore.addNewRow('tab-1')
			gridStore.selectFullRow('tab-1', 1, 2)
			gridStore.deleteSelectedRows('tab-1')
			// 1 update + 1 insert + 1 delete = 3
			expect(gridStore.pendingChangesCount('tab-1')).toBe(3)
		})

		test('does not double-count edits on deleted rows', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.deleteSelectedRows('tab-1')
			// Row 0 is deleted; the edit should not count separately
			expect(gridStore.pendingChangesCount('tab-1')).toBe(1)
		})
	})

	describe('revertRowUpdate', () => {
		test('reverts cell edits for specific row', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.setCellValue('tab-1', 0, 'name', 'Updated')
			gridStore.setCellValue('tab-1', 0, 'id', 999)
			gridStore.setCellValue('tab-1', 1, 'name', 'Also Updated')

			gridStore.revertRowUpdate('tab-1', 0)

			const tab = gridStore.getTab('tab-1')!
			expect(tab.rows[0].name).toBe('Alice')
			expect(tab.rows[0].id).toBe(1)
			expect(tab.rows[1].name).toBe('Also Updated') // unchanged
			expect(Object.keys(tab.pendingChanges.cellEdits)).toHaveLength(1)
		})
	})

	describe('revertNewRow', () => {
		test('reverts a new row and adjusts indices', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			const idx1 = gridStore.addNewRow('tab-1')
			const idx2 = gridStore.addNewRow('tab-1')
			gridStore.setCellValue('tab-1', idx2, 'name', 'Second New')

			gridStore.revertNewRow('tab-1', idx1)

			const tab = gridStore.getTab('tab-1')!
			// Original 3 + 1 remaining new row = 4
			expect(tab.rows).toHaveLength(4)
			expect(tab.pendingChanges.newRows.size).toBe(1)
			// The second new row should now be at index 3 (was 4, adjusted after removal of 3)
			expect(tab.pendingChanges.newRows.has(3)).toBe(true)
		})
	})

	describe('revertDeletedRow', () => {
		test('unmarks a deleted row', async () => {
			await gridStore.loadTableData('tab-1', 'conn-1', 'public', 'users')
			gridStore.selectFullRow('tab-1', 0, 2)
			gridStore.deleteSelectedRows('tab-1')
			expect(gridStore.isRowDeleted('tab-1', 0)).toBe(true)

			gridStore.revertDeletedRow('tab-1', 0)

			expect(gridStore.isRowDeleted('tab-1', 0)).toBe(false)
			expect(gridStore.hasPendingChanges('tab-1')).toBe(false)
		})
	})
})
