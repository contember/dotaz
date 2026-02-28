import { createStore } from "solid-js/store";
import type {
	ColumnFilter,
	GridColumnDef,
	SortColumn,
} from "../../shared/types/grid";
import { rpc } from "../lib/rpc";

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

export interface TabGridState {
	connectionId: string;
	schema: string;
	table: string;
	columns: GridColumnDef[];
	rows: Record<string, unknown>[];
	totalCount: number;
	currentPage: number;
	pageSize: number;
	sort: SortColumn[];
	filters: ColumnFilter[];
	selectedRows: Set<number>;
	focusedCell: FocusedCell | null;
	columnConfig: Record<string, ColumnConfig>;
	columnOrder: string[];
	loading: boolean;
}

function createDefaultTabState(
	connectionId: string,
	schema: string,
	table: string,
): TabGridState {
	return {
		connectionId,
		schema,
		table,
		columns: [],
		rows: [],
		totalCount: 0,
		currentPage: 1,
		pageSize: 100,
		sort: [],
		filters: [],
		selectedRows: new Set(),
		focusedCell: null,
		columnConfig: {},
		columnOrder: [],
		loading: false,
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

function getTab(tabId: string): TabGridState | undefined {
	return state.tabs[tabId];
}

function ensureTab(tabId: string): TabGridState {
	const tab = getTab(tabId);
	if (!tab) {
		throw new Error(`Grid state not found for tab ${tabId}`);
	}
	return tab;
}

async function fetchData(tabId: string) {
	const tab = ensureTab(tabId);
	setState("tabs", tabId, "loading", true);
	try {
		const response = await rpc.data.getTableData({
			connectionId: tab.connectionId,
			schema: tab.schema,
			table: tab.table,
			page: tab.currentPage,
			pageSize: tab.pageSize,
			sort: tab.sort.length > 0 ? tab.sort : undefined,
			filters: tab.filters.length > 0 ? tab.filters : undefined,
		});
		setState("tabs", tabId, {
			columns: response.columns,
			rows: response.rows,
			totalCount: response.totalRows,
			currentPage: response.page,
			loading: false,
		});
	} catch (err) {
		setState("tabs", tabId, "loading", false);
		throw err;
	}
}

// ── Actions ──────────────────────────────────────────────

async function loadTableData(
	tabId: string,
	connectionId: string,
	schema: string,
	table: string,
) {
	if (!getTab(tabId)) {
		setState("tabs", tabId, createDefaultTabState(connectionId, schema, table));
	}
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
	const rows = sortedIndices.map((i) => {
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
				background: "var(--bg-panel)",
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
				background: "var(--bg-panel)",
			});
			rightOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH;
		}
	}

	return styles;
}

function removeTab(tabId: string) {
	setState("tabs", tabId, undefined!);
}

// ── Export ────────────────────────────────────────────────

export const gridStore = {
	getTab,

	loadTableData,
	setPage,
	setPageSize,
	toggleSort,
	setFilter,
	removeFilter,
	clearFilters,
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
};
