import { describe, expect, test, beforeEach, mock } from "bun:test";
import type { GridDataResponse } from "../src/shared/types/grid";

// ── Mock solid-js/store ──────────────────────────────────

let storeState: any;

mock.module("solid-js/store", () => ({
	createStore: (initial: any) => {
		storeState = structuredClone(initial);

		const setStore = (...args: any[]) => {
			if (args.length === 3) {
				// setState("tabs", tabId, value) or setState("tabs", tabId, undefined)
				const [key, subKey, value] = args;
				if (value === undefined) {
					delete storeState[key][subKey];
				} else if (typeof value === "object" && value !== null && !(value instanceof Set)) {
					// Merge object into existing
					storeState[key][subKey] = { ...storeState[key]?.[subKey], ...value };
				} else {
					if (!storeState[key]) storeState[key] = {};
					storeState[key][subKey] = value;
				}
			} else if (args.length === 4) {
				// setState("tabs", tabId, "field", value)
				const [key, subKey, field, value] = args;
				if (typeof value === "function") {
					storeState[key][subKey][field] = value(storeState[key][subKey][field]);
				} else {
					storeState[key][subKey][field] = value;
				}
			}
		};

		return [storeState, setStore];
	},
}));

// ── Mock RPC ─────────────────────────────────────────────

let mockGetTableData: ReturnType<typeof mock>;

mock.module("../src/mainview/lib/rpc", () => {
	mockGetTableData = mock(() =>
		Promise.resolve(makeResponse()),
	);

	return {
		rpc: {
			data: {
				getTableData: mockGetTableData,
			},
		},
	};
});

// ── Import after mocks ───────────────────────────────────

const { gridStore } = await import("../src/mainview/stores/grid");

// ── Test helpers ─────────────────────────────────────────

function makeResponse(overrides?: Partial<GridDataResponse>): GridDataResponse {
	return {
		columns: [
			{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true },
			{ name: "name", dataType: "text", nullable: true, isPrimaryKey: false },
		],
		rows: [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
			{ id: 3, name: "Charlie" },
		],
		totalRows: 50,
		page: 1,
		pageSize: 100,
		...overrides,
	};
}

function resetState() {
	storeState.tabs = {};
	mockGetTableData.mockReset();
	mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse()));
}

// ── Tests ────────────────────────────────────────────────

describe("grid store", () => {
	beforeEach(() => {
		resetState();
	});

	describe("loadTableData", () => {
		test("creates tab state and loads data via RPC", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			const tab = gridStore.getTab("tab-1");
			expect(tab).toBeDefined();
			expect(tab!.connectionId).toBe("conn-1");
			expect(tab!.schema).toBe("public");
			expect(tab!.table).toBe("users");
			expect(tab!.columns).toHaveLength(2);
			expect(tab!.rows).toHaveLength(3);
			expect(tab!.totalCount).toBe(50);
			expect(tab!.loading).toBe(false);

			expect(mockGetTableData).toHaveBeenCalledTimes(1);
			expect(mockGetTableData).toHaveBeenCalledWith({
				connectionId: "conn-1",
				schema: "public",
				table: "users",
				page: 1,
				pageSize: 100,
				sort: undefined,
				filters: undefined,
			});
		});

		test("reuses existing tab state on subsequent calls", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			expect(mockGetTableData).toHaveBeenCalledTimes(2);
			// Tab should still exist
			expect(gridStore.getTab("tab-1")).toBeDefined();
		});
	});

	describe("per-tab isolation", () => {
		test("each tab has independent state", async () => {
			const response1 = makeResponse({
				rows: [{ id: 1, name: "Alice" }],
				totalRows: 10,
			});
			const response2 = makeResponse({
				rows: [{ id: 100, name: "Zara" }],
				totalRows: 200,
			});

			mockGetTableData.mockImplementationOnce(() => Promise.resolve(response1));
			mockGetTableData.mockImplementationOnce(() => Promise.resolve(response2));

			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			await gridStore.loadTableData("tab-2", "conn-2", "mydb", "orders");

			const tab1 = gridStore.getTab("tab-1")!;
			const tab2 = gridStore.getTab("tab-2")!;

			expect(tab1.connectionId).toBe("conn-1");
			expect(tab1.table).toBe("users");
			expect(tab1.totalCount).toBe(10);

			expect(tab2.connectionId).toBe("conn-2");
			expect(tab2.table).toBe("orders");
			expect(tab2.totalCount).toBe(200);
		});

		test("modifying one tab does not affect another", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			await gridStore.loadTableData("tab-2", "conn-2", "main", "items");

			gridStore.selectAll("tab-1");
			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(3);
			expect(gridStore.getTab("tab-2")!.selectedRows.size).toBe(0);
		});
	});

	describe("pagination", () => {
		test("setPage updates page and reloads data", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			const page2Response = makeResponse({ page: 2, totalRows: 50 });
			mockGetTableData.mockImplementationOnce(() => Promise.resolve(page2Response));

			await gridStore.setPage("tab-1", 2);

			expect(mockGetTableData).toHaveBeenCalledTimes(2);
			const lastCall = mockGetTableData.mock.calls[1][0] as any;
			expect(lastCall.page).toBe(2);
		});

		test("setPage clears row selection", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			gridStore.selectAll("tab-1");
			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(3);

			await gridStore.setPage("tab-1", 2);
			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(0);
		});

		test("setPageSize updates page size and resets to page 1", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse({ page: 2 })));
			await gridStore.setPage("tab-1", 2);

			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse({ page: 1, pageSize: 50 })));
			await gridStore.setPageSize("tab-1", 50);

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.pageSize).toBe(50);
			expect(tab.currentPage).toBe(1);
		});

		test("setPageSize clears row selection", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			gridStore.selectAll("tab-1");
			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(3);

			await gridStore.setPageSize("tab-1", 25);
			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(0);
		});

		test("setPageSize sends new page size in RPC request", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.setPageSize("tab-1", 250);

			const lastCall = mockGetTableData.mock.calls[1][0] as any;
			expect(lastCall.pageSize).toBe(250);
			expect(lastCall.page).toBe(1);
		});
	});

	describe("sorting", () => {
		test("toggleSort adds ascending sort on first click", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.toggleSort("tab-1", "name");

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.sort).toEqual([{ column: "name", direction: "asc" }]);
			// Should have reloaded data
			expect(mockGetTableData).toHaveBeenCalledTimes(2);
		});

		test("toggleSort changes to descending on second click", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.toggleSort("tab-1", "name");
			await gridStore.toggleSort("tab-1", "name");

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.sort).toEqual([{ column: "name", direction: "desc" }]);
		});

		test("toggleSort removes sort on third click", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.toggleSort("tab-1", "name");
			await gridStore.toggleSort("tab-1", "name");
			await gridStore.toggleSort("tab-1", "name");

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.sort).toEqual([]);
		});

		test("toggleSort resets to page 1", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			// Move to page 2
			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse({ page: 2 })));
			await gridStore.setPage("tab-1", 2);

			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse({ page: 1 })));
			await gridStore.toggleSort("tab-1", "name");

			expect(gridStore.getTab("tab-1")!.currentPage).toBe(1);
		});

		test("toggleSort sends sort in RPC request", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			await gridStore.toggleSort("tab-1", "id");

			const lastCall = mockGetTableData.mock.calls[1][0] as any;
			expect(lastCall.sort).toEqual([{ column: "id", direction: "asc" }]);
		});
	});

	describe("filtering", () => {
		test("setFilter adds a new filter and reloads", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.setFilter("tab-1", {
				column: "name",
				operator: "eq",
				value: "Alice",
			});

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.filters).toHaveLength(1);
			expect(tab.filters[0]).toEqual({
				column: "name",
				operator: "eq",
				value: "Alice",
			});
			expect(mockGetTableData).toHaveBeenCalledTimes(2);
		});

		test("setFilter updates existing filter for same column", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.setFilter("tab-1", {
				column: "name",
				operator: "eq",
				value: "Alice",
			});
			await gridStore.setFilter("tab-1", {
				column: "name",
				operator: "like",
				value: "%ob%",
			});

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.filters).toHaveLength(1);
			expect(tab.filters[0].operator).toBe("like");
			expect(tab.filters[0].value).toBe("%ob%");
		});

		test("setFilter resets to page 1", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");
			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse({ page: 2 })));
			await gridStore.setPage("tab-1", 2);

			mockGetTableData.mockImplementation(() => Promise.resolve(makeResponse()));
			await gridStore.setFilter("tab-1", {
				column: "id",
				operator: "gt",
				value: 5,
			});

			expect(gridStore.getTab("tab-1")!.currentPage).toBe(1);
		});

		test("clearFilters removes all filters and reloads", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.setFilter("tab-1", { column: "name", operator: "eq", value: "Alice" });
			await gridStore.setFilter("tab-1", { column: "id", operator: "gt", value: 5 });

			await gridStore.clearFilters("tab-1");

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.filters).toHaveLength(0);
		});

		test("setFilter sends filters in RPC request", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			await gridStore.setFilter("tab-1", {
				column: "name",
				operator: "eq",
				value: "Alice",
			});

			const lastCall = mockGetTableData.mock.calls[1][0] as any;
			expect(lastCall.filters).toEqual([
				{ column: "name", operator: "eq", value: "Alice" },
			]);
		});
	});

	describe("row selection", () => {
		test("selectRow selects a single row", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 0);

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.selectedRows.has(0)).toBe(true);
			expect(tab.selectedRows.size).toBe(1);
		});

		test("selectRow deselects if already selected", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 0);
			gridStore.selectRow("tab-1", 0);

			expect(gridStore.getTab("tab-1")!.selectedRows.size).toBe(0);
		});

		test("selectRow clears previous selection when selecting a different row", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 0);
			gridStore.selectRow("tab-1", 1);

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.selectedRows.size).toBe(1);
			expect(tab.selectedRows.has(1)).toBe(true);
			expect(tab.selectedRows.has(0)).toBe(false);
		});

		test("selectRange selects a range of rows", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRange("tab-1", 0, 2);

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.selectedRows.size).toBe(3);
			expect(tab.selectedRows.has(0)).toBe(true);
			expect(tab.selectedRows.has(1)).toBe(true);
			expect(tab.selectedRows.has(2)).toBe(true);
		});

		test("selectRange handles reversed from/to", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRange("tab-1", 2, 0);

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.selectedRows.size).toBe(3);
		});

		test("selectAll selects all rows", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectAll("tab-1");

			const tab = gridStore.getTab("tab-1")!;
			expect(tab.selectedRows.size).toBe(3);
		});

		test("getSelectedData returns data for selected rows in order", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRange("tab-1", 0, 1);
			const data = gridStore.getSelectedData("tab-1");

			expect(data).toHaveLength(2);
			expect(data[0]).toEqual({ id: 1, name: "Alice" });
			expect(data[1]).toEqual({ id: 2, name: "Bob" });
		});
	});

	describe("removeTab", () => {
		test("removes tab state", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.removeTab("tab-1");
			expect(gridStore.getTab("tab-1")).toBeUndefined();
		});
	});

	describe("clipboard / TSV export", () => {
		test("formatCellForClipboard handles null and undefined", () => {
			expect(gridStore.formatCellForClipboard(null)).toBe("");
			expect(gridStore.formatCellForClipboard(undefined)).toBe("");
		});

		test("formatCellForClipboard handles strings", () => {
			expect(gridStore.formatCellForClipboard("hello")).toBe("hello");
		});

		test("formatCellForClipboard handles numbers and booleans", () => {
			expect(gridStore.formatCellForClipboard(42)).toBe("42");
			expect(gridStore.formatCellForClipboard(true)).toBe("true");
		});

		test("formatCellForClipboard serializes objects as JSON", () => {
			expect(gridStore.formatCellForClipboard({ a: 1 })).toBe('{"a":1}');
		});

		test("formatCellForClipboard strips tabs and newlines from strings", () => {
			expect(gridStore.formatCellForClipboard("a\tb\nc")).toBe("a b c");
		});

		test("buildClipboardTsv returns null when no rows selected", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			const tab = gridStore.getTab("tab-1")!;
			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result).toBeNull();
		});

		test("buildClipboardTsv copies single cell when focusedCell is set", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 0);
			gridStore.setFocusedCell("tab-1", { row: 0, column: "name" });

			const tab = gridStore.getTab("tab-1")!;
			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result).not.toBeNull();
			expect(result!.text).toBe("Alice");
			expect(result!.rowCount).toBe(0);
		});

		test("buildClipboardTsv copies single cell with NULL as empty string", async () => {
			const response = makeResponse({
				rows: [{ id: 1, name: null }],
			});
			mockGetTableData.mockImplementationOnce(() => Promise.resolve(response));
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 0);
			gridStore.setFocusedCell("tab-1", { row: 0, column: "name" });

			const tab = gridStore.getTab("tab-1")!;
			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result!.text).toBe("");
		});

		test("buildClipboardTsv copies multiple rows as TSV with header", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRange("tab-1", 0, 2);

			const tab = gridStore.getTab("tab-1")!;
			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result).not.toBeNull();
			expect(result!.rowCount).toBe(3);

			const lines = result!.text.split("\n");
			expect(lines).toHaveLength(4); // header + 3 rows
			expect(lines[0]).toBe("id\tname");
			expect(lines[1]).toBe("1\tAlice");
			expect(lines[2]).toBe("2\tBob");
			expect(lines[3]).toBe("3\tCharlie");
		});

		test("buildClipboardTsv copies single row (no focused cell) as TSV with header", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRow("tab-1", 1);
			// Don't set focusedCell

			const tab = gridStore.getTab("tab-1")!;
			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result).not.toBeNull();
			expect(result!.rowCount).toBe(1);

			const lines = result!.text.split("\n");
			expect(lines).toHaveLength(2); // header + 1 row
			expect(lines[0]).toBe("id\tname");
			expect(lines[1]).toBe("2\tBob");
		});

		test("buildClipboardTsv with multiple rows ignores focusedCell", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.selectRange("tab-1", 0, 1);
			// selectRange clears focusedCell, but even if it were set,
			// multi-row copies all visible columns
			const tab = gridStore.getTab("tab-1")!;
			expect(tab.focusedCell).toBeNull();

			const cols = gridStore.getVisibleColumns(tab);
			const result = gridStore.buildClipboardTsv("tab-1", cols);

			expect(result!.rowCount).toBe(2);
		});
	});

	describe("focusedCell", () => {
		test("setFocusedCell sets and clears focused cell", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.setFocusedCell("tab-1", { row: 0, column: "name" });
			expect(gridStore.getTab("tab-1")!.focusedCell).toEqual({ row: 0, column: "name" });

			gridStore.setFocusedCell("tab-1", null);
			expect(gridStore.getTab("tab-1")!.focusedCell).toBeNull();
		});

		test("selectRange clears focusedCell", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.setFocusedCell("tab-1", { row: 0, column: "name" });
			gridStore.selectRange("tab-1", 0, 2);

			expect(gridStore.getTab("tab-1")!.focusedCell).toBeNull();
		});

		test("selectAll clears focusedCell", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			gridStore.setFocusedCell("tab-1", { row: 0, column: "name" });
			gridStore.selectAll("tab-1");

			expect(gridStore.getTab("tab-1")!.focusedCell).toBeNull();
		});
	});

	describe("error handling", () => {
		test("throws for operations on non-existent tabs", () => {
			expect(() => gridStore.selectRow("nonexistent", 0)).toThrow(
				"Grid state not found for tab nonexistent",
			);
		});

		test("loading remains false after RPC error", async () => {
			await gridStore.loadTableData("tab-1", "conn-1", "public", "users");

			mockGetTableData.mockImplementationOnce(() =>
				Promise.reject(new Error("Connection lost")),
			);

			await expect(gridStore.setPage("tab-1", 2)).rejects.toThrow("Connection lost");
			expect(gridStore.getTab("tab-1")!.loading).toBe(false);
		});
	});
});
