import { createStore } from "solid-js/store";
import type {
	ColumnFilter,
	GridColumnDef,
	SortColumn,
} from "../../shared/types/grid";
import type { DataChange, SavedViewConfig } from "../../shared/types/rpc";
import {
	buildSelectQuery,
	buildCountQuery,
	buildQuickSearchClause,
	generateChangeSql,
	generateChangesPreview,
} from "../../shared/sql";
import { rpc } from "../lib/rpc";
import { createTabHelpers } from "../lib/tab-store-helpers";
import { connectionsStore } from "./connections";

// ── Column config (visibility, order, widths, pinned) ────

export interface ColumnConfig {
	visible: boolean;
	width?: number;
	pinned?: "left" | "right";
}

// ── Per-tab grid state ───────────────────────────────────

export interface FocusedCell {
	row: number;
	column: string;
}

export interface EditingCell {
	row: number;
	column: string;
}

/** A pending cell-level change, keyed by "rowIndex:columnName". */
export interface CellChange {
	rowIndex: number;
	column: string;
	oldValue: unknown;
	newValue: unknown;
}

/** Track new rows and deleted rows alongside cell edits. */
export interface PendingChanges {
	/** Cell-level edits keyed by "rowIndex:columnName". */
	cellEdits: Record<string, CellChange>;
	/** Row indices of new rows (appended at end). */
	newRows: Set<number>;
	/** Row indices marked for deletion. */
	deletedRows: Set<number>;
}

/** A snapshot of the table state for FK back-navigation. */
export interface FkNavigationEntry {
	schema: string;
	table: string;
	database?: string;
	filters: ColumnFilter[];
	sort: SortColumn[];
	columnConfig: Record<string, ColumnConfig>;
	columnOrder: string[];
}

/** FK target info for a single-column foreign key. */
export interface FkTarget {
	schema: string;
	table: string;
	column: string;
}

export interface TabGridState {
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
	columns: GridColumnDef[];
	rows: Record<string, unknown>[];
	totalCount: number;
	currentPage: number;
	pageSize: number;
	sort: SortColumn[];
	filters: ColumnFilter[];
	quickSearch: string;
	selectedRows: Set<number>;
	focusedCell: FocusedCell | null;
	editingCell: EditingCell | null;
	pendingChanges: PendingChanges;
	columnConfig: Record<string, ColumnConfig>;
	columnOrder: string[];
	loading: boolean;
	lastLoadedAt: number | null;
	activeViewId: string | null;
	activeViewName: string | null;
	fkNavigationHistory: FkNavigationEntry[];
}

function createDefaultPendingChanges(): PendingChanges {
	return {
		cellEdits: {},
		newRows: new Set(),
		deletedRows: new Set(),
	};
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
		quickSearch: "",
		selectedRows: new Set(),
		focusedCell: null,
		editingCell: null,
		pendingChanges: createDefaultPendingChanges(),
		columnConfig: {},
		columnOrder: [],
		loading: false,
		lastLoadedAt: null,
		activeViewId: null,
		activeViewName: null,
		fkNavigationHistory: [],
	};
}

// ── Store ────────────────────────────────────────────────

interface GridStoreState {
	tabs: Record<string, TabGridState>;
}

const [state, setState] = createStore<GridStoreState>({
	tabs: {},
});

// ── Internal helpers ─────────────────────────────────────

/** Tracks the latest fetch request ID per tab to prevent stale responses. */
const latestFetchId = new Map<string, number>();
let fetchSequence = 0;

const { getTab, ensureTab } = createTabHelpers(() => state.tabs, "Grid");

async function fetchData(tabId: string) {
	const tab = ensureTab(tabId);
	const requestId = ++fetchSequence;
	latestFetchId.set(tabId, requestId);

	setState("tabs", tabId, "loading", true);
	try {
		const dialect = connectionsStore.getDialect(tab.connectionId);

		// Get column metadata from cached schema
		const cachedColumns = connectionsStore.getColumns(tab.connectionId, tab.schema, tab.table, tab.database);
		const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
			name: c.name,
			dataType: c.dataType,
			nullable: c.nullable,
			isPrimaryKey: c.isPrimaryKey,
		}));

		// Build quick search clause if search term is provided
		const filters = tab.filters.length > 0 ? tab.filters : undefined;
		const sort = tab.sort.length > 0 ? tab.sort : undefined;
		const filterParamCount = (filters ?? []).reduce((sum, f) => {
			if (f.operator === "isNull" || f.operator === "isNotNull") return sum;
			if (f.operator === "in" || f.operator === "notIn") {
				return sum + (Array.isArray(f.value) ? f.value.length : 1);
			}
			return sum + 1;
		}, 0);
		const quickSearchClause = tab.quickSearch
			? buildQuickSearchClause(gridColumns, tab.quickSearch, dialect, filterParamCount)
			: undefined;

		// Build and execute data query
		const selectQuery = buildSelectQuery(
			tab.schema, tab.table, tab.currentPage, tab.pageSize,
			sort, filters, dialect, quickSearchClause,
		);
		const countQuery = buildCountQuery(tab.schema, tab.table, filters, dialect, quickSearchClause);

		// Execute both queries
		const queryId = `grid-${tabId}-${requestId}`;
		const [dataResults, countResults] = await Promise.all([
			rpc.query.execute({ connectionId: tab.connectionId, sql: selectQuery.sql, queryId, params: selectQuery.params, database: tab.database }),
			rpc.query.execute({ connectionId: tab.connectionId, sql: countQuery.sql, queryId: `${queryId}-count`, params: countQuery.params, database: tab.database }),
		]);

		// Ignore stale responses — a newer request has been issued
		if (latestFetchId.get(tabId) !== requestId) return;

		const rows = dataResults[0]?.rows ?? [];
		const totalRows = Number(countResults[0]?.rows[0]?.count ?? 0);

		setState("tabs", tabId, {
			columns: gridColumns,
			rows,
			totalCount: totalRows,
			currentPage: tab.currentPage,
			loading: false,
			lastLoadedAt: Date.now(),
			selectedRows: new Set<number>(),
			focusedCell: null,
			editingCell: null,
		});
	} catch (err) {
		// Ignore errors from stale requests
		if (latestFetchId.get(tabId) !== requestId) return;

		setState("tabs", tabId, "loading", false);
		// Re-throw so the global unhandled rejection handler in AppShell shows a toast
		throw err;
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
		setState("tabs", tabId, createDefaultTabState(connectionId, schema, table, database));
	}
	await fetchData(tabId);
}

async function refreshData(tabId: string) {
	ensureTab(tabId);
	await fetchData(tabId);
}

async function setPage(tabId: string, page: number) {
	ensureTab(tabId);
	setState("tabs", tabId, "currentPage", page);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function setPageSize(tabId: string, pageSize: number) {
	ensureTab(tabId);
	setState("tabs", tabId, "pageSize", pageSize);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function toggleSort(tabId: string, column: string, multi = false) {
	const tab = ensureTab(tabId);
	const existing = tab.sort.find((s) => s.column === column);
	let newSort: SortColumn[];

	if (!multi) {
		// Single sort: replace entire sort list with this column
		if (!existing) {
			newSort = [{ column, direction: "asc" }];
		} else if (existing.direction === "asc") {
			newSort = [{ column, direction: "desc" }];
		} else {
			newSort = [];
		}
	} else {
		// Multi-sort: add/toggle/remove within existing list
		if (!existing) {
			newSort = [...tab.sort, { column, direction: "asc" }];
		} else if (existing.direction === "asc") {
			newSort = tab.sort.map((s) =>
				s.column === column ? { column, direction: "desc" as const } : s,
			);
		} else {
			newSort = tab.sort.filter((s) => s.column !== column);
		}
	}

	setState("tabs", tabId, "sort", newSort);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function setFilter(tabId: string, filter: ColumnFilter) {
	const tab = ensureTab(tabId);
	const idx = tab.filters.findIndex((f) => f.column === filter.column);
	if (idx === -1) {
		setState("tabs", tabId, "filters", [...tab.filters, filter]);
	} else {
		setState("tabs", tabId, "filters", (filters) =>
			filters.map((f, i) => (i === idx ? filter : f)),
		);
	}
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function removeFilter(tabId: string, column: string) {
	const tab = ensureTab(tabId);
	setState(
		"tabs",
		tabId,
		"filters",
		tab.filters.filter((f) => f.column !== column),
	);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function setQuickSearch(tabId: string, search: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "quickSearch", search);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function clearFilters(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "filters", []);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

function selectRow(tabId: string, index: number) {
	const tab = ensureTab(tabId);
	const next = new Set<number>();
	if (!tab.selectedRows.has(index)) {
		next.add(index);
	}
	setState("tabs", tabId, "selectedRows", next);
}

function toggleRowInSelection(tabId: string, index: number) {
	const tab = ensureTab(tabId);
	const next = new Set(tab.selectedRows);
	if (next.has(index)) {
		next.delete(index);
	} else {
		next.add(index);
	}
	setState("tabs", tabId, "selectedRows", next);
}

function selectRange(tabId: string, from: number, to: number) {
	const start = Math.min(from, to);
	const end = Math.max(from, to);
	const next = new Set<number>();
	for (let i = start; i <= end; i++) {
		next.add(i);
	}
	setState("tabs", tabId, "selectedRows", next);
	setState("tabs", tabId, "focusedCell", null);
}

function selectAll(tabId: string) {
	const tab = ensureTab(tabId);
	const next = new Set<number>();
	for (let i = 0; i < tab.rows.length; i++) {
		next.add(i);
	}
	setState("tabs", tabId, "selectedRows", next);
	setState("tabs", tabId, "focusedCell", null);
}

function setFocusedCell(tabId: string, cell: FocusedCell | null) {
	ensureTab(tabId);
	setState("tabs", tabId, "focusedCell", cell);
}

function getSelectedData(tabId: string): Record<string, unknown>[] {
	const tab = ensureTab(tabId);
	return [...tab.selectedRows].sort((a, b) => a - b).map((i) => tab.rows[i]);
}

/** Format a cell value for TSV clipboard export. NULL → empty string. */
function formatCellForClipboard(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value).replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
}

/**
 * Build TSV string for clipboard from current selection.
 * Returns the TSV text and the count of copied rows (0 = single cell).
 */
function buildClipboardTsv(
	tabId: string,
	visibleColumns: GridColumnDef[],
): { text: string; rowCount: number } | null {
	const tab = ensureTab(tabId);
	const selected = tab.selectedRows;

	if (selected.size === 0) return null;

	// Single row + focused cell → copy just the cell value
	if (selected.size === 1 && tab.focusedCell) {
		const rowIdx = [...selected][0];
		const row = tab.rows[rowIdx];
		if (!row) return null;
		const value = row[tab.focusedCell.column];
		return { text: formatCellForClipboard(value), rowCount: 0 };
	}

	// Multi-row or single row without focused cell → copy all visible columns
	const colNames = visibleColumns.map((c) => c.name);
	const header = colNames.join("\t");
	const sortedIndices = [...selected].sort((a, b) => a - b);
	const rows = sortedIndices
		.filter((i) => tab.rows[i] != null)
		.map((i) => {
			const row = tab.rows[i];
			return colNames.map((col) => formatCellForClipboard(row[col])).join("\t");
		});

	return { text: [header, ...rows].join("\n"), rowCount: sortedIndices.length };
}

function setColumnWidth(tabId: string, column: string, width: number) {
	const tab = ensureTab(tabId);
	const existing = tab.columnConfig[column];
	setState("tabs", tabId, "columnConfig", {
		...tab.columnConfig,
		[column]: {
			visible: existing?.visible ?? true,
			width: Math.max(50, width),
			pinned: existing?.pinned,
		},
	});
}

function setColumnVisibility(tabId: string, column: string, visible: boolean) {
	const tab = ensureTab(tabId);
	const existing = tab.columnConfig[column];
	setState("tabs", tabId, "columnConfig", {
		...tab.columnConfig,
		[column]: {
			visible,
			width: existing?.width,
			pinned: existing?.pinned,
		},
	});
}

function setColumnPinned(
	tabId: string,
	column: string,
	pinned: "left" | "right" | undefined,
) {
	const tab = ensureTab(tabId);
	const existing = tab.columnConfig[column];
	setState("tabs", tabId, "columnConfig", {
		...tab.columnConfig,
		[column]: {
			visible: existing?.visible ?? true,
			width: existing?.width,
			pinned,
		},
	});
}

function setColumnOrder(tabId: string, order: string[]) {
	setState("tabs", tabId, "columnOrder", order);
}

function resetColumnConfig(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "columnConfig", {});
	setState("tabs", tabId, "columnOrder", []);
}

/** Returns all columns in user-defined order (or natural order). Includes hidden columns. */
function getOrderedColumns(tab: TabGridState): GridColumnDef[] {
	if (tab.columnOrder.length === 0) return tab.columns;
	const orderMap = new Map(tab.columnOrder.map((name, i) => [name, i]));
	return [...tab.columns].sort((a, b) => {
		const ai = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
		const bi = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
		return ai - bi;
	});
}

/** Returns visible columns ordered for rendering: left-pinned, normal, right-pinned. */
function getVisibleColumns(tab: TabGridState): GridColumnDef[] {
	const ordered = getOrderedColumns(tab);
	const visible = ordered.filter(
		(col) => tab.columnConfig[col.name]?.visible !== false,
	);

	const left: GridColumnDef[] = [];
	const normal: GridColumnDef[] = [];
	const right: GridColumnDef[] = [];

	for (const col of visible) {
		const pin = tab.columnConfig[col.name]?.pinned;
		if (pin === "left") left.push(col);
		else if (pin === "right") right.push(col);
		else normal.push(col);
	}

	return [...left, ...normal, ...right];
}

const DEFAULT_COLUMN_WIDTH = 150;

/** Computes sticky position styles for pinned columns. */
function computePinStyles(
	columns: GridColumnDef[],
	columnConfig: Record<string, ColumnConfig>,
): Map<string, Record<string, string>> {
	const styles = new Map<string, Record<string, string>>();

	let leftOffset = 0;
	for (const col of columns) {
		if (columnConfig[col.name]?.pinned === "left") {
			styles.set(col.name, {
				position: "sticky",
				left: `${leftOffset}px`,
				"z-index": "3",
				background: "var(--surface-raised)",
			});
			leftOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH;
		}
	}

	let rightOffset = 0;
	for (let i = columns.length - 1; i >= 0; i--) {
		const col = columns[i];
		if (columnConfig[col.name]?.pinned === "right") {
			styles.set(col.name, {
				position: "sticky",
				right: `${rightOffset}px`,
				"z-index": "3",
				background: "var(--surface-raised)",
			});
			rightOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH;
		}
	}

	return styles;
}

// ── Editing actions ───────────────────────────────────────

function startEditing(tabId: string, row: number, column: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "editingCell", { row, column });
}

function stopEditing(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "editingCell", null);
}

function setCellValue(tabId: string, rowIndex: number, column: string, newValue: unknown) {
	const tab = ensureTab(tabId);
	const key = `${rowIndex}:${column}`;
	const existing = tab.pendingChanges.cellEdits[key];
	const oldValue = existing ? existing.oldValue : tab.rows[rowIndex]?.[column];

	// If reverting to original value, remove the edit
	if (oldValue === newValue) {
		const next = { ...tab.pendingChanges.cellEdits };
		delete next[key];
		setState("tabs", tabId, "pendingChanges", "cellEdits", next);
	} else {
		setState("tabs", tabId, "pendingChanges", "cellEdits", key, {
			rowIndex,
			column,
			oldValue,
			newValue,
		});
	}

	// Also update the actual row data for display
	setState("tabs", tabId, "rows", rowIndex, column, newValue);
}

function addNewRow(tabId: string) {
	const tab = ensureTab(tabId);
	const emptyRow: Record<string, unknown> = {};
	for (const col of tab.columns) {
		emptyRow[col.name] = null;
	}
	const newIndex = tab.rows.length;
	setState("tabs", tabId, "rows", [...tab.rows, emptyRow]);
	const next = new Set(tab.pendingChanges.newRows);
	next.add(newIndex);
	setState("tabs", tabId, "pendingChanges", "newRows", next);
	return newIndex;
}

function deleteSelectedRows(tabId: string) {
	const tab = ensureTab(tabId);
	if (tab.selectedRows.size === 0) return;
	const next = new Set(tab.pendingChanges.deletedRows);

	// Collect new-row indices to remove from the rows array
	const newRowIndicesToRemove: number[] = [];

	for (const idx of tab.selectedRows) {
		if (tab.pendingChanges.newRows.has(idx)) {
			newRowIndicesToRemove.push(idx);
		} else {
			next.add(idx);
		}
	}

	// Remove new rows from rows array (process in reverse to preserve indices)
	if (newRowIndicesToRemove.length > 0) {
		newRowIndicesToRemove.sort((a, b) => b - a);
		for (const idx of newRowIndicesToRemove) {
			// Remove cell edits for this row
			const edits = { ...tab.pendingChanges.cellEdits };
			for (const key of Object.keys(edits)) {
				if (key.startsWith(`${idx}:`)) delete edits[key];
			}
			setState("tabs", tabId, "pendingChanges", "cellEdits", edits);

			// Remove from newRows
			const nextNew = new Set(tab.pendingChanges.newRows);
			nextNew.delete(idx);
			setState("tabs", tabId, "pendingChanges", "newRows", nextNew);

			// Remove row from array
			const filteredRows = tab.rows.filter((_, i) => i !== idx);
			setState("tabs", tabId, "rows", filteredRows);

			// Adjust indices for remaining pending changes
			adjustIndicesAfterRemoval(tabId, idx);
		}
	}

	setState("tabs", tabId, "pendingChanges", "deletedRows", next);
	setState("tabs", tabId, "selectedRows", new Set());
}

function hasPendingChanges(tabId: string): boolean {
	const tab = getTab(tabId);
	if (!tab) return false;
	return (
		Object.keys(tab.pendingChanges.cellEdits).length > 0 ||
		tab.pendingChanges.newRows.size > 0 ||
		tab.pendingChanges.deletedRows.size > 0
	);
}

/** Count total number of distinct changes (grouped by type: update rows, inserts, deletes). */
function pendingChangesCount(tabId: string): number {
	const tab = getTab(tabId);
	if (!tab) return 0;

	// Count distinct rows with cell edits (excluding new/deleted rows)
	const editedRows = new Set<number>();
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (!tab.pendingChanges.newRows.has(edit.rowIndex) &&
			!tab.pendingChanges.deletedRows.has(edit.rowIndex)) {
			editedRows.add(edit.rowIndex);
		}
	}

	return editedRows.size + tab.pendingChanges.newRows.size + tab.pendingChanges.deletedRows.size;
}

/** Revert all cell edits for a specific existing row (undo UPDATE). */
function revertRowUpdate(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId);
	const edits = { ...tab.pendingChanges.cellEdits };
	for (const [key, edit] of Object.entries(edits)) {
		if (edit.rowIndex === rowIndex) {
			setState("tabs", tabId, "rows", rowIndex, edit.column, edit.oldValue);
			delete edits[key];
		}
	}
	setState("tabs", tabId, "pendingChanges", "cellEdits", edits);
}

/** Revert a new row (undo INSERT). */
function revertNewRow(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId);

	// Remove cell edits for this row
	const edits = { ...tab.pendingChanges.cellEdits };
	for (const key of Object.keys(edits)) {
		if (key.startsWith(`${rowIndex}:`)) delete edits[key];
	}
	setState("tabs", tabId, "pendingChanges", "cellEdits", edits);

	// Remove from newRows
	const nextNew = new Set(tab.pendingChanges.newRows);
	nextNew.delete(rowIndex);
	setState("tabs", tabId, "pendingChanges", "newRows", nextNew);

	// Remove the row from rows array and adjust indices in pendingChanges
	const filteredRows = tab.rows.filter((_, i) => i !== rowIndex);
	setState("tabs", tabId, "rows", filteredRows);

	// Adjust indices for all pending changes that reference rows after the removed one
	adjustIndicesAfterRemoval(tabId, rowIndex);
}

/** Revert a deleted row (undo DELETE). */
function revertDeletedRow(tabId: string, rowIndex: number) {
	const tab = ensureTab(tabId);
	const next = new Set(tab.pendingChanges.deletedRows);
	next.delete(rowIndex);
	setState("tabs", tabId, "pendingChanges", "deletedRows", next);
}

/** Adjust all pending change indices after a row removal. */
function adjustIndicesAfterRemoval(tabId: string, removedIndex: number) {
	const tab = ensureTab(tabId);

	// Adjust cellEdits keys
	const oldEdits = tab.pendingChanges.cellEdits;
	const newEdits: Record<string, CellChange> = {};
	for (const [, edit] of Object.entries(oldEdits)) {
		if (edit.rowIndex > removedIndex) {
			const adjusted = { ...edit, rowIndex: edit.rowIndex - 1 };
			newEdits[`${adjusted.rowIndex}:${adjusted.column}`] = adjusted;
		} else {
			newEdits[`${edit.rowIndex}:${edit.column}`] = edit;
		}
	}
	setState("tabs", tabId, "pendingChanges", "cellEdits", newEdits);

	// Adjust newRows
	const newNewRows = new Set<number>();
	for (const idx of tab.pendingChanges.newRows) {
		newNewRows.add(idx > removedIndex ? idx - 1 : idx);
	}
	setState("tabs", tabId, "pendingChanges", "newRows", newNewRows);

	// Adjust deletedRows
	const newDeletedRows = new Set<number>();
	for (const idx of tab.pendingChanges.deletedRows) {
		newDeletedRows.add(idx > removedIndex ? idx - 1 : idx);
	}
	setState("tabs", tabId, "pendingChanges", "deletedRows", newDeletedRows);
}

function isCellChanged(tabId: string, rowIndex: number, column: string): boolean {
	const tab = getTab(tabId);
	if (!tab) return false;
	return `${rowIndex}:${column}` in tab.pendingChanges.cellEdits;
}

function isRowNew(tabId: string, rowIndex: number): boolean {
	const tab = getTab(tabId);
	if (!tab) return false;
	return tab.pendingChanges.newRows.has(rowIndex);
}

function isRowDeleted(tabId: string, rowIndex: number): boolean {
	const tab = getTab(tabId);
	if (!tab) return false;
	return tab.pendingChanges.deletedRows.has(rowIndex);
}

/**
 * Build DataChange array from pending changes for backend submission.
 */
function buildDataChanges(tabId: string): DataChange[] {
	const tab = ensureTab(tabId);
	const changes: DataChange[] = [];
	const pkColumns = tab.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

	// Collect updates: group cell edits by row
	const editsByRow = new Map<number, Record<string, unknown>>();
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (tab.pendingChanges.newRows.has(edit.rowIndex)) continue; // new rows handled separately
		if (tab.pendingChanges.deletedRows.has(edit.rowIndex)) continue; // deleted rows handled separately
		let rowEdits = editsByRow.get(edit.rowIndex);
		if (!rowEdits) {
			rowEdits = {};
			editsByRow.set(edit.rowIndex, rowEdits);
		}
		rowEdits[edit.column] = edit.newValue;
	}

	for (const [rowIndex, values] of editsByRow) {
		const row = tab.rows[rowIndex];
		const primaryKeys: Record<string, unknown> = {};
		for (const pk of pkColumns) {
			// Use original value if the PK was edited, otherwise current value
			const cellEdit = tab.pendingChanges.cellEdits[`${rowIndex}:${pk}`];
			primaryKeys[pk] = cellEdit ? cellEdit.oldValue : row[pk];
		}
		changes.push({
			type: "update",
			schema: tab.schema,
			table: tab.table,
			primaryKeys,
			values,
		});
	}

	// Collect inserts (new rows)
	for (const rowIndex of tab.pendingChanges.newRows) {
		const row = tab.rows[rowIndex];
		if (!row) continue;
		const values: Record<string, unknown> = {};
		for (const col of tab.columns) {
			if (row[col.name] !== null && row[col.name] !== undefined) {
				values[col.name] = row[col.name];
			}
		}
		changes.push({
			type: "insert",
			schema: tab.schema,
			table: tab.table,
			values,
		});
	}

	// Collect deletes
	for (const rowIndex of tab.pendingChanges.deletedRows) {
		const row = tab.rows[rowIndex];
		if (!row) continue;
		const primaryKeys: Record<string, unknown> = {};
		for (const pk of pkColumns) {
			primaryKeys[pk] = row[pk];
		}
		changes.push({
			type: "delete",
			schema: tab.schema,
			table: tab.table,
			primaryKeys,
		});
	}

	return changes;
}

async function applyChanges(tabId: string, database?: string) {
	const tab = ensureTab(tabId);
	const changes = buildDataChanges(tabId);
	if (changes.length === 0) return;

	const dialect = connectionsStore.getDialect(tab.connectionId);
	const statements = changes.map((change) => generateChangeSql(change, dialect));
	await rpc.query.execute({ connectionId: tab.connectionId, sql: "", queryId: "", statements, database });
}

function generateSqlPreview(tabId: string): string {
	const tab = ensureTab(tabId);
	const changes = buildDataChanges(tabId);
	if (changes.length === 0) return "";
	const dialect = connectionsStore.getDialect(tab.connectionId);
	return generateChangesPreview(changes, dialect);
}

function revertChanges(tabId: string) {
	const tab = ensureTab(tabId);

	// Revert cell edits to original values
	for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
		if (!tab.pendingChanges.newRows.has(edit.rowIndex)) {
			setState("tabs", tabId, "rows", edit.rowIndex, edit.column, edit.oldValue);
		}
	}

	// Remove new rows from end
	const newRowIndices = [...tab.pendingChanges.newRows].sort((a, b) => b - a);
	if (newRowIndices.length > 0) {
		const filteredRows = tab.rows.filter((_, i) => !tab.pendingChanges.newRows.has(i));
		setState("tabs", tabId, "rows", filteredRows);
	}

	// Clear all pending changes
	setState("tabs", tabId, "pendingChanges", createDefaultPendingChanges());
	setState("tabs", tabId, "editingCell", null);
}

/** Clear pending changes tracking without reverting cell values (used after successful apply). */
function clearPendingChanges(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "pendingChanges", createDefaultPendingChanges());
	setState("tabs", tabId, "editingCell", null);
}

// ── Saved view actions ────────────────────────────────────

function setActiveView(tabId: string, viewId: string | null, viewName: string | null) {
	ensureTab(tabId);
	setState("tabs", tabId, "activeViewId", viewId);
	setState("tabs", tabId, "activeViewName", viewName);
}

async function applyViewConfig(tabId: string, config: SavedViewConfig) {
	const tab = ensureTab(tabId);

	setState("tabs", tabId, "sort", config.sort ?? []);

	setState("tabs", tabId, "filters", config.filters ?? []);

	if (config.columns) {
		const visibleSet = new Set(config.columns);
		const newConfig: Record<string, ColumnConfig> = {};
		for (const col of tab.columns) {
			newConfig[col.name] = {
				visible: visibleSet.has(col.name),
				width: config.columnWidths?.[col.name],
				pinned: tab.columnConfig[col.name]?.pinned,
			};
		}
		setState("tabs", tabId, "columnConfig", newConfig);
		setState("tabs", tabId, "columnOrder", config.columns);
	}

	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

async function resetToDefault(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "sort", []);
	setState("tabs", tabId, "filters", []);
	setState("tabs", tabId, "quickSearch", "");
	setState("tabs", tabId, "columnConfig", {});
	setState("tabs", tabId, "columnOrder", []);
	setState("tabs", tabId, "activeViewId", null);
	setState("tabs", tabId, "activeViewName", null);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

/** Compare current grid state against a saved view config. Ignores columnWidths to reduce noise. */
function isViewModified(tabId: string, savedConfig: SavedViewConfig): boolean {
	const tab = getTab(tabId);
	if (!tab) return false;

	// Compare sort
	const currentSort = tab.sort.map(s => `${s.column}:${s.direction}`).join(",");
	const savedSort = (savedConfig.sort ?? []).map(s => `${s.column}:${s.direction}`).join(",");
	if (currentSort !== savedSort) return true;

	// Compare filters
	const currentFilters = tab.filters.map(f => `${f.column}:${f.operator}:${f.value}`).join(",");
	const savedFilters = (savedConfig.filters ?? []).map(f => `${f.column}:${f.operator}:${f.value}`).join(",");
	if (currentFilters !== savedFilters) return true;

	// Compare visible columns (order matters)
	if (savedConfig.columns) {
		const visibleCols = getVisibleColumns(tab).map(c => c.name);
		if (visibleCols.join(",") !== savedConfig.columns.join(",")) return true;
	}

	return false;
}

function captureViewConfig(tabId: string): SavedViewConfig {
	const tab = ensureTab(tabId);
	const visible = getVisibleColumns(tab);
	const columnWidths: Record<string, number> = {};
	for (const col of tab.columns) {
		if (tab.columnConfig[col.name]?.width) {
			columnWidths[col.name] = tab.columnConfig[col.name].width!;
		}
	}

	return {
		columns: visible.map(c => c.name),
		sort: [...tab.sort],
		filters: [...tab.filters],
		columnWidths: Object.keys(columnWidths).length > 0 ? columnWidths : undefined,
	};
}

// ── FK navigation actions ─────────────────────────────────

async function navigateToFkTarget(
	tabId: string,
	targetSchema: string,
	targetTable: string,
	targetColumn: string,
	value: unknown,
) {
	const tab = ensureTab(tabId);

	// Push current state to navigation history
	const entry: FkNavigationEntry = {
		schema: tab.schema,
		table: tab.table,
		database: tab.database,
		filters: [...tab.filters],
		sort: [...tab.sort],
		columnConfig: { ...tab.columnConfig },
		columnOrder: [...tab.columnOrder],
	};
	setState("tabs", tabId, "fkNavigationHistory", [...tab.fkNavigationHistory, entry]);

	// Navigate to target table with filter
	setState("tabs", tabId, "schema", targetSchema);
	setState("tabs", tabId, "table", targetTable);
	setState("tabs", tabId, "filters", [
		{ column: targetColumn, operator: "eq", value: String(value) },
	]);
	setState("tabs", tabId, "sort", []);
	setState("tabs", tabId, "quickSearch", "");
	setState("tabs", tabId, "columnConfig", {});
	setState("tabs", tabId, "columnOrder", []);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	setState("tabs", tabId, "focusedCell", null);
	setState("tabs", tabId, "editingCell", null);
	setState("tabs", tabId, "pendingChanges", createDefaultPendingChanges());
	setState("tabs", tabId, "activeViewId", null);
	setState("tabs", tabId, "activeViewName", null);

	await fetchData(tabId);
}

async function navigateToTableWithFilters(
	tabId: string,
	targetSchema: string,
	targetTable: string,
	filters: ColumnFilter[],
) {
	const tab = ensureTab(tabId);

	const entry: FkNavigationEntry = {
		schema: tab.schema,
		table: tab.table,
		database: tab.database,
		filters: [...tab.filters],
		sort: [...tab.sort],
		columnConfig: { ...tab.columnConfig },
		columnOrder: [...tab.columnOrder],
	};
	setState("tabs", tabId, "fkNavigationHistory", [...tab.fkNavigationHistory, entry]);

	setState("tabs", tabId, "schema", targetSchema);
	setState("tabs", tabId, "table", targetTable);
	setState("tabs", tabId, "filters", filters);
	setState("tabs", tabId, "sort", []);
	setState("tabs", tabId, "quickSearch", "");
	setState("tabs", tabId, "columnConfig", {});
	setState("tabs", tabId, "columnOrder", []);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	setState("tabs", tabId, "focusedCell", null);
	setState("tabs", tabId, "editingCell", null);
	setState("tabs", tabId, "pendingChanges", createDefaultPendingChanges());
	setState("tabs", tabId, "activeViewId", null);
	setState("tabs", tabId, "activeViewName", null);

	await fetchData(tabId);
}

async function navigateBack(tabId: string) {
	const tab = ensureTab(tabId);
	if (tab.fkNavigationHistory.length === 0) return;

	const history = [...tab.fkNavigationHistory];
	const entry = history.pop()!;
	setState("tabs", tabId, "fkNavigationHistory", history);

	// Restore previous state
	setState("tabs", tabId, "schema", entry.schema);
	setState("tabs", tabId, "table", entry.table);
	setState("tabs", tabId, "database", entry.database);
	setState("tabs", tabId, "filters", entry.filters);
	setState("tabs", tabId, "sort", entry.sort);
	setState("tabs", tabId, "columnConfig", entry.columnConfig);
	setState("tabs", tabId, "columnOrder", entry.columnOrder);
	setState("tabs", tabId, "quickSearch", "");
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	setState("tabs", tabId, "focusedCell", null);
	setState("tabs", tabId, "editingCell", null);
	setState("tabs", tabId, "pendingChanges", createDefaultPendingChanges());
	setState("tabs", tabId, "activeViewId", null);
	setState("tabs", tabId, "activeViewName", null);

	await fetchData(tabId);
}

function removeTab(tabId: string) {
	latestFetchId.delete(tabId);
	setState("tabs", tabId, undefined!);
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
	setQuickSearch,
	selectRow,
	toggleRowInSelection,
	selectRange,
	selectAll,
	getSelectedData,
	setFocusedCell,
	buildClipboardTsv,
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

	// FK navigation
	navigateToFkTarget,
	navigateToTableWithFilters,
	navigateBack,

	// Saved views
	setActiveView,
	applyViewConfig,
	resetToDefault,
	captureViewConfig,
	isViewModified,

	// Editing
	startEditing,
	stopEditing,
	setCellValue,
	addNewRow,
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
};
