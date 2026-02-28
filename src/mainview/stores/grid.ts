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
	columnConfig: Record<string, ColumnConfig>;
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
		columnConfig: {},
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

async function clearFilters(tabId: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "filters", []);
	setState("tabs", tabId, "currentPage", 1);
	setState("tabs", tabId, "selectedRows", new Set());
	await fetchData(tabId);
}

function selectRow(tabId: string, index: number) {
	const tab = ensureTab(tabId);
	const next = new Set(tab.selectedRows);
	if (next.has(index)) {
		next.delete(index);
	} else {
		next.clear();
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
}

function selectAll(tabId: string) {
	const tab = ensureTab(tabId);
	const next = new Set<number>();
	for (let i = 0; i < tab.rows.length; i++) {
		next.add(i);
	}
	setState("tabs", tabId, "selectedRows", next);
}

function getSelectedData(tabId: string): Record<string, unknown>[] {
	const tab = ensureTab(tabId);
	return [...tab.selectedRows].sort((a, b) => a - b).map((i) => tab.rows[i]);
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

function removeTab(tabId: string) {
	setState("tabs", tabId, undefined!);
}

// ── Export ────────────────────────────────────────────────

export const gridStore = {
	getTab,

	loadTableData,
	setPage,
	toggleSort,
	setFilter,
	clearFilters,
	selectRow,
	selectRange,
	selectAll,
	getSelectedData,
	setColumnWidth,
	removeTab,
};
