import { createEffect, createMemo, createSignal, For, on, onMount, onCleanup, Show } from "solid-js";
import type { ColumnFilter } from "../../../shared/types/grid";
import type { ForeignKeyInfo } from "../../../shared/types/database";
import type { SavedViewConfig } from "../../../shared/types/rpc";
import type { FkTarget } from "../../stores/grid";
import { gridStore } from "../../stores/grid";
import { tabsStore } from "../../stores/tabs";
import { viewsStore } from "../../stores/views";
import { connectionsStore } from "../../stores/connections";
import { rpc } from "../../lib/rpc";
import { createKeyHandler } from "../../lib/keyboard";
import GridHeader from "./GridHeader";
import VirtualScroller from "./VirtualScroller";
import FilterBar from "./FilterBar";
import ColumnManager from "./ColumnManager";
import Pagination from "./Pagination";
import RowDetailDialog from "../edit/RowDetailDialog";
import AggregatePanel from "./AggregatePanel";
import TransposedGrid from "./TransposedGrid";
import ValueEditorPanel from "./ValueEditorPanel";
import PendingChanges from "../edit/PendingChanges";
import SaveViewDialog from "../views/SaveViewDialog";
import ExportDialog from "../export/ExportDialog";
import ImportDialog from "../import/ImportDialog";
import ContextMenu from "../common/ContextMenu";
import type { ContextMenuEntry } from "../common/ContextMenu";
import Icon from "../common/Icon";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Save from "lucide-solid/icons/save";
import Pencil from "lucide-solid/icons/pencil";
import ArrowLeftRight from "lucide-solid/icons/arrow-left-right";
import PanelRightOpen from "lucide-solid/icons/panel-right-open";
import { HEADER_HEIGHT } from "../../lib/layout-constants";
import "./DataGrid.css";

interface DataGridProps {
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
}
const COPY_FLASH_DURATION = 400;

/** Build a map from source column → FK target for single-column FKs. */
function buildFkMap(foreignKeys: ForeignKeyInfo[]): Map<string, FkTarget> {
	const map = new Map<string, FkTarget>();
	for (const fk of foreignKeys) {
		if (fk.columns.length === 1) {
			map.set(fk.columns[0], {
				schema: fk.referencedSchema,
				table: fk.referencedTable,
				column: fk.referencedColumns[0],
			});
		}
	}
	return map;
}

export default function DataGrid(props: DataGridProps) {
	const [fkColumns, setFkColumns] = createSignal<Set<string>>(new Set());
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([]);
	const [fkMap, setFkMap] = createSignal<Map<string, FkTarget>>(new Map());
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);
	const [rowDetailIndex, setRowDetailIndex] = createSignal<number | null>(null);
	const [showPendingPanel, setShowPendingPanel] = createSignal(false);
	const [saveViewOpen, setSaveViewOpen] = createSignal(false);
	const [exportOpen, setExportOpen] = createSignal(false);
	const [importOpen, setImportOpen] = createSignal(false);
	const [cellContextMenu, setCellContextMenu] = createSignal<{
		x: number;
		y: number;
		rowIndex: number;
		column: string;
	} | null>(null);
	const [headerContextMenu, setHeaderContextMenu] = createSignal<{
		x: number;
		y: number;
		column: string;
	} | null>(null);
	const [saveViewForceNew, setSaveViewForceNew] = createSignal(false);
	const [savedViewConfig, setSavedViewConfig] = createSignal<SavedViewConfig | null>(null);
	const [now, setNow] = createSignal(Date.now());
	const [searchInput, setSearchInput] = createSignal("");
	let scrollRef: HTMLDivElement | undefined;
	let gridRef: HTMLDivElement | undefined;
	let anchorRow = -1;
	let staleTimer: ReturnType<typeof setInterval> | undefined;
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	const tab = () => gridStore.getTab(props.tabId);
	const tabInfo = () => tabsStore.openTabs.find((t) => t.id === props.tabId);
	const isReadOnly = () => connectionsStore.isReadOnly(props.connectionId);

	// Current schema/table from tab state (changes on FK navigation)
	const currentSchema = () => tab()?.schema ?? props.schema;
	const currentTable = () => tab()?.table ?? props.table;

	const hasActiveView = () => !!tab()?.activeViewId;
	const isModified = () => {
		const config = savedViewConfig();
		if (!config) return false;
		return gridStore.isViewModified(props.tabId, config);
	};

	const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

	/** Returns a human-readable "ago" string if data is stale (>5 min), otherwise null. */
	const staleLabel = createMemo(() => {
		const t = tab();
		if (!t?.lastLoadedAt) return null;
		const elapsed = now() - t.lastLoadedAt;
		if (elapsed < STALE_THRESHOLD_MS) return null;
		const minutes = Math.floor(elapsed / 60_000);
		if (minutes < 60) return `Data loaded ${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		return `Data loaded ${hours}h ago`;
	});

	// Tick `now` every 30s so stale label updates
	onMount(() => {
		staleTimer = setInterval(() => setNow(Date.now()), 30_000);
	});
	// Listen for import dialog open events from context menu
	function handleOpenImport(e: Event) {
		const detail = (e as CustomEvent).detail;
		if (detail?.connectionId === props.connectionId &&
			detail?.schema === currentSchema() &&
			detail?.table === currentTable()) {
			setImportOpen(true);
		}
	}
	onMount(() => {
		window.addEventListener("dotaz:open-import", handleOpenImport);
	});
	onCleanup(() => {
		if (staleTimer) clearInterval(staleTimer);
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		window.removeEventListener("dotaz:open-import", handleOpenImport);
	});

	// Sync tab dirty flag with pending changes state
	createEffect(() => {
		const dirty = gridStore.hasPendingChanges(props.tabId);
		tabsStore.setTabDirty(props.tabId, dirty);
		// Auto-hide panel when no pending changes
		if (!dirty) setShowPendingPanel(false);
	});

	// Track view modification status
	createEffect(() => {
		const config = savedViewConfig();
		if (!config || !hasActiveView()) {
			tabsStore.setViewModified(props.tabId, false);
			return;
		}
		const modified = gridStore.isViewModified(props.tabId, config);
		tabsStore.setViewModified(props.tabId, modified);
	});

	const visibleColumns = () => {
		const t = tab();
		return t ? gridStore.getVisibleColumns(t) : [];
	};

	const pinStyles = () => {
		const t = tab();
		if (!t) return new Map<string, Record<string, string>>();
		return gridStore.computePinStyles(visibleColumns(), t.columnConfig);
	};

	onMount(async () => {
		const existing = gridStore.getTab(props.tabId);
		if (!existing || existing.columns.length === 0) {
			await gridStore.loadTableData(props.tabId, props.connectionId, props.schema, props.table, props.database);
		}

		// Apply saved view config if this tab was opened for a specific view
		const ti = tabInfo();
		if (ti?.viewId) {
			const view = viewsStore.getViewById(props.connectionId, ti.viewId);
			if (view) {
				gridStore.setActiveView(props.tabId, view.id, view.name);
				await gridStore.applyViewConfig(props.tabId, view.config);
				setSavedViewConfig(view.config);
			}
		}

		loadForeignKeys(props.schema, props.table);
	});

	// Reload FK info when the table changes (e.g. after FK navigation).
	// defer: true skips the initial run (handled by onMount).
	createEffect(on(
		() => [currentSchema(), currentTable()] as const,
		([schema, table]) => loadForeignKeys(schema, table),
		{ defer: true },
	));

	function loadForeignKeys(schema: string, table: string) {
		const fks = connectionsStore.getForeignKeys(
			props.connectionId,
			schema,
			table,
			props.database,
		);
		setForeignKeys(fks);
		const fkCols = new Set<string>();
		for (const fk of fks) {
			for (const col of fk.columns) {
				fkCols.add(col);
			}
		}
		setFkColumns(fkCols);
		setFkMap(buildFkMap(fks));
	}

	function handleQuickSearchInput(value: string) {
		setSearchInput(value);
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			gridStore.setQuickSearch(props.tabId, value);
		}, 300);
	}

	function handleClearQuickSearch() {
		setSearchInput("");
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		gridStore.setQuickSearch(props.tabId, "");
	}

	function handleRefresh() {
		gridStore.refreshData(props.tabId);
	}

	function handleToggleSort(column: string, multi: boolean) {
		gridStore.toggleSort(props.tabId, column, multi);
	}

	function handleResizeColumn(column: string, width: number) {
		gridStore.setColumnWidth(props.tabId, column, width);
	}

	function handleAddFilter(filter: ColumnFilter) {
		gridStore.setFilter(props.tabId, filter);
	}

	function handleRemoveFilter(column: string) {
		gridStore.removeFilter(props.tabId, column);
	}

	function handleClearFilters() {
		gridStore.clearFilters(props.tabId);
	}

	function handleRowClick(index: number, e: MouseEvent) {
		// Detect which cell was clicked via data-column attribute
		const target = e.target as HTMLElement;
		const cellEl = target.closest<HTMLElement>("[data-column]");
		const columnName = cellEl?.dataset.column ?? null;

		if (e.shiftKey && anchorRow >= 0) {
			gridStore.selectRange(props.tabId, anchorRow, index);
		} else if (e.ctrlKey || e.metaKey) {
			gridStore.toggleRowInSelection(props.tabId, index);
			if (anchorRow < 0) anchorRow = index;
		} else {
			gridStore.selectRow(props.tabId, index);
			anchorRow = index;
		}

		// Set focused cell for single-cell copy
		if (columnName && !e.shiftKey) {
			gridStore.setFocusedCell(props.tabId, { row: index, column: columnName });
		}
	}

	// ── Editing handlers ──────────────────────────────────

	function handleRowDblClick(index: number, e: MouseEvent) {
		if (isReadOnly()) return;
		const target = e.target as HTMLElement;
		const cellEl = target.closest<HTMLElement>("[data-column]");
		const columnName = cellEl?.dataset.column;
		if (columnName && !gridStore.isRowDeleted(props.tabId, index)) {
			gridStore.startEditing(props.tabId, index, columnName);
		}
	}

	function startEditingFocused() {
		if (isReadOnly()) return;
		const t = tab();
		if (!t?.focusedCell) return;
		if (gridStore.isRowDeleted(props.tabId, t.focusedCell.row)) return;
		gridStore.startEditing(props.tabId, t.focusedCell.row, t.focusedCell.column);
	}

	function handleCellSave(rowIndex: number, column: string, value: unknown) {
		gridStore.setCellValue(props.tabId, rowIndex, column, value);
		gridStore.stopEditing(props.tabId);
	}

	function handleCellCancel() {
		gridStore.stopEditing(props.tabId);
	}

	function handleCellMoveNext(rowIndex: number, currentColumn: string) {
		const cols = visibleColumns();
		const idx = cols.findIndex((c) => c.name === currentColumn);
		if (idx < cols.length - 1) {
			const nextCol = cols[idx + 1].name;
			gridStore.startEditing(props.tabId, rowIndex, nextCol);
			gridStore.setFocusedCell(props.tabId, { row: rowIndex, column: nextCol });
		} else {
			gridStore.stopEditing(props.tabId);
		}
	}

	function handleCellMoveDown(rowIndex: number, currentColumn: string) {
		const t = tab();
		if (!t) return;
		if (rowIndex < t.rows.length - 1) {
			gridStore.startEditing(props.tabId, rowIndex + 1, currentColumn);
			gridStore.setFocusedCell(props.tabId, { row: rowIndex + 1, column: currentColumn });
		} else {
			gridStore.stopEditing(props.tabId);
		}
	}

	function handleAddNewRow() {
		if (isReadOnly()) return;
		const newIndex = gridStore.addNewRow(props.tabId);
		const cols = visibleColumns();
		if (cols.length > 0) {
			gridStore.startEditing(props.tabId, newIndex, cols[0].name);
			gridStore.setFocusedCell(props.tabId, { row: newIndex, column: cols[0].name });
		}
	}

	function handleDeleteSelected() {
		if (isReadOnly()) return;
		gridStore.deleteSelectedRows(props.tabId);
	}

	function getChangedCells(rowIndex: number): Set<string> {
		const t = tab();
		if (!t) return new Set();
		const changed = new Set<string>();
		for (const key of Object.keys(t.pendingChanges.cellEdits)) {
			const edit = t.pendingChanges.cellEdits[key];
			if (edit.rowIndex === rowIndex) {
				changed.add(edit.column);
			}
		}
		return changed;
	}

	// ── Row Detail Dialog ────────────────────────────────────

	function openRowDetail() {
		const t = tab();
		if (!t) return;
		// Use first selected row
		const selected = [...t.selectedRows].sort((a, b) => a - b);
		if (selected.length === 0) return;
		setRowDetailIndex(selected[0]);
	}

	function handleRowDetailSave(rowIndex: number, changes: Record<string, unknown>) {
		for (const [column, value] of Object.entries(changes)) {
			gridStore.setCellValue(props.tabId, rowIndex, column, value);
		}
	}

	function handleRowDetailClose() {
		setRowDetailIndex(null);
	}

	function handleRowDetailNavigate(rowIndex: number) {
		setRowDetailIndex(rowIndex);
		// Also update selection in the grid
		gridStore.selectRow(props.tabId, rowIndex);
	}

	// ── Pending changes ──────────────────────────────────────

	function handleChangesApplied() {
		// Reload data from server after successful apply
		gridStore.refreshData(props.tabId);
	}

	// ── Saved views ────────────────────────────────────────

	async function handleQuickSave() {
		const t = tab();
		if (!t?.activeViewId) {
			setSaveViewForceNew(false);
			setSaveViewOpen(true);
			return;
		}
		try {
			const config = gridStore.captureViewConfig(props.tabId);
			const updated = await rpc.views.update({
				id: t.activeViewId,
				name: t.activeViewName!,
				config,
			});
			setSavedViewConfig(updated.config);
			tabsStore.setTabView(props.tabId, updated.id, updated.name);
			await viewsStore.refreshViews(props.connectionId);
		} catch {
			// Fall back to dialog on error
			setSaveViewOpen(true);
		}
	}

	async function handleResetView() {
		const config = savedViewConfig();
		if (!config) return;
		await gridStore.applyViewConfig(props.tabId, config);
	}

	function handleSaveAsNew() {
		setSaveViewForceNew(true);
		setSaveViewOpen(true);
	}

	function generateAutoName(): string {
		const t = tab();
		if (!t) return "";
		const parts: string[] = [];
		if (t.filters.length > 0) {
			const cols = t.filters.map((f) => f.column).join(", ");
			parts.push(`filtered by ${cols}`);
		}
		if (t.sort.length > 0) {
			const cols = t.sort.map((s) => s.column).join(", ");
			parts.push(`sorted by ${cols}`);
		}
		return parts.length > 0 ? parts.join(", ") : "Custom view";
	}

	// ── FK navigation ─────────────────────────────────────

	function handleFkClick(rowIndex: number, column: string) {
		const t = tab();
		if (!t) return;
		const target = fkMap().get(column);
		if (!target) return;
		const value = t.rows[rowIndex]?.[column];
		if (value === null || value === undefined) return;

		gridStore.navigateToFkTarget(
			props.tabId,
			target.schema,
			target.table,
			target.column,
			value,
		);
		// Update tab title to reflect the current table
		tabsStore.renameTab(props.tabId, target.table);
	}

	function handleFkBack() {
		const t = tab();
		if (!t || t.fkNavigationHistory.length === 0) return;

		const prev = t.fkNavigationHistory[t.fkNavigationHistory.length - 1];
		gridStore.navigateBack(props.tabId);
		// Restore tab title
		tabsStore.renameTab(props.tabId, prev.table);
	}

	function handleDuplicateRow(rowIndex: number) {
		const t = tab();
		if (!t) return;
		const sourceRow = t.rows[rowIndex];
		if (!sourceRow) return;
		const newIndex = gridStore.addNewRow(props.tabId);
		for (const col of t.columns) {
			if (col.isPrimaryKey) continue;
			const value = sourceRow[col.name];
			if (value !== null && value !== undefined) {
				gridStore.setCellValue(props.tabId, newIndex, col.name, value);
			}
		}
	}

	// ── Clipboard ──────────────────────────────────────────

	async function handleCopy() {
		const result = gridStore.buildClipboardTsv(props.tabId, visibleColumns());
		if (!result) return;

		try {
			await navigator.clipboard.writeText(result.text);
			const msg = result.rowCount === 0
				? "Copied cell"
				: `Copied ${result.rowCount} row${result.rowCount > 1 ? "s" : ""}`;
			setCopyFeedback(msg);
			setTimeout(() => setCopyFeedback(null), COPY_FLASH_DURATION);
		} catch {
			// Clipboard API may fail in some contexts
		}
	}

	// ── Context menus ────────────────────────────────────────

	function handleGridContextMenu(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const cellEl = target.closest<HTMLElement>("[data-column]");
		if (!cellEl) return;
		const columnName = cellEl.dataset.column;
		if (!columnName) return;

		const t = tab();
		if (!t) return;

		const focusedCell = t.focusedCell;
		if (!focusedCell) return;

		e.preventDefault();
		setHeaderContextMenu(null);
		setCellContextMenu({
			x: e.clientX,
			y: e.clientY,
			rowIndex: focusedCell.row,
			column: columnName,
		});
	}

	function handleHeaderContextMenu(e: MouseEvent, column: string) {
		e.preventDefault();
		setCellContextMenu(null);
		setHeaderContextMenu({
			x: e.clientX,
			y: e.clientY,
			column,
		});
	}

	function closeContextMenus() {
		setCellContextMenu(null);
		setHeaderContextMenu(null);
	}

	// Listen for save-view events dispatched by the command registry
	onMount(() => {
		const onSaveView = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.tabId === props.tabId) {
				handleQuickSave();
			}
		};
		window.addEventListener("dotaz:save-view", onSaveView);
		onCleanup(() => window.removeEventListener("dotaz:save-view", onSaveView));
	});

	const handleKeyDown = createKeyHandler([
		{
			key: "c",
			ctrl: true,
			handler(e) {
				e.preventDefault();
				handleCopy();
			},
		},
		{
			key: "a",
			ctrl: true,
			handler(e) {
				e.preventDefault();
				gridStore.selectAll(props.tabId);
			},
		},
		{
			key: "F2",
			handler(e) {
				e.preventDefault();
				e.stopPropagation(); // Prevent KeyboardManager double-fire
				startEditingFocused();
			},
		},
		{
			key: "Insert",
			ctrl: true,
			handler(e) {
				e.preventDefault();
				handleAddNewRow();
			},
		},
		{
			key: "Delete",
			handler(e) {
				e.preventDefault();
				e.stopPropagation(); // Prevent KeyboardManager double-fire
				handleDeleteSelected();
			},
		},
		{
			key: "Enter",
			handler(e) {
				const t = tab();
				if (t?.editingCell) return; // Don't open detail while inline editing
				if (t && t.selectedRows.size > 0) {
					e.preventDefault();
					openRowDetail();
				}
			},
		},
		{
			key: "s",
			ctrl: true,
			handler(e) {
				e.preventDefault();
				e.stopPropagation(); // Prevent KeyboardManager double-fire
				handleQuickSave();
			},
		},
		{
			key: "Escape",
			handler(e) {
				const t = tab();
				if (t?.editingCell) {
					e.preventDefault();
					handleCellCancel();
				}
			},
		},
	]);

	const cellContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = cellContextMenu();
		if (!ctx) return [];
		const t = tab();
		if (!t) return [];
		const { rowIndex, column } = ctx;
		const row = t.rows[rowIndex];
		const value = row?.[column];
		const isDeleted = gridStore.isRowDeleted(props.tabId, rowIndex);

		const ro = isReadOnly();
		const items: ContextMenuEntry[] = [
			{
				label: "Copy Value",
				action: async () => {
					await navigator.clipboard.writeText(
						gridStore.formatCellForClipboard(value),
					);
				},
			},
			{
				label: "Copy Row",
				action: async () => {
					const cols = visibleColumns();
					const header = cols.map((c) => c.name).join("\t");
					const rowText = cols
						.map((c) => gridStore.formatCellForClipboard(row[c.name]))
						.join("\t");
					await navigator.clipboard.writeText(`${header}\n${rowText}`);
				},
			},
			"separator",
			{
				label: "Edit Cell",
				action: () => gridStore.startEditing(props.tabId, rowIndex, column),
				disabled: isDeleted || ro,
			},
			{
				label: "Set NULL",
				action: () => gridStore.setCellValue(props.tabId, rowIndex, column, null),
				disabled: isDeleted || ro,
			},
			"separator",
			{
				label: "Filter by This Value",
				action: () => {
					const filterValue = value === null ? "" : String(value);
					const operator = value === null ? "isNull" as const : "eq" as const;
					gridStore.setFilter(props.tabId, {
						column,
						operator,
						value: filterValue,
					});
				},
			},
			{
				label: "Sort Ascending",
				action: () => gridStore.toggleSort(props.tabId, column, false),
			},
			{
				label: "Sort Descending",
				action: () => {
					// Toggle twice: first to asc, then to desc
					const t = tab();
					const existing = t?.sort.find((s) => s.column === column);
					if (!existing || existing.direction === "desc") {
						gridStore.toggleSort(props.tabId, column, false); // → asc
					}
					gridStore.toggleSort(props.tabId, column, false); // → desc
				},
			},
			"separator",
			{
				label: "Row Detail",
				action: () => {
					gridStore.selectRow(props.tabId, rowIndex);
					setRowDetailIndex(rowIndex);
				},
			},
			{
				label: "Delete Row",
				action: () => {
					gridStore.selectRow(props.tabId, rowIndex);
					gridStore.deleteSelectedRows(props.tabId);
				},
				disabled: isDeleted || ro,
			},
			{
				label: "Duplicate Row",
				action: () => handleDuplicateRow(rowIndex),
				disabled: ro,
			},
		];

		// FK-specific items
		const fkTarget = fkMap().get(column);
		if (fkTarget && value !== null && value !== undefined) {
			items.push("separator");
			items.push({
				label: "Go to referenced row",
				action: () => handleFkClick(rowIndex, column),
			});
			items.push({
				label: `Open ${fkTarget.table}`,
				action: () => {
					tabsStore.openTab({
						type: "data-grid",
						title: fkTarget.table,
						connectionId: props.connectionId,
						schema: fkTarget.schema,
						table: fkTarget.table,
						database: props.database,
					});
				},
			});
		}

		return items;
	};

	const headerContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = headerContextMenu();
		if (!ctx) return [];
		const { column } = ctx;
		const t = tab();
		const pinned = t?.columnConfig[column]?.pinned;

		return [
			{
				label: "Sort Ascending",
				action: () => gridStore.toggleSort(props.tabId, column, false),
			},
			{
				label: "Sort Descending",
				action: () => {
					const existing = t?.sort.find((s) => s.column === column);
					if (!existing || existing.direction === "desc") {
						gridStore.toggleSort(props.tabId, column, false);
					}
					gridStore.toggleSort(props.tabId, column, false);
				},
			},
			"separator",
			{
				label: "Hide Column",
				action: () => gridStore.setColumnVisibility(props.tabId, column, false),
			},
			"separator",
			{
				label: "Pin Left",
				action: () => gridStore.setColumnPinned(props.tabId, column, "left"),
				disabled: pinned === "left",
			},
			{
				label: "Pin Right",
				action: () => gridStore.setColumnPinned(props.tabId, column, "right"),
				disabled: pinned === "right",
			},
			...(pinned
				? [
						{
							label: "Unpin",
							action: () => gridStore.setColumnPinned(props.tabId, column, undefined),
						} as ContextMenuEntry,
					]
				: []),
			"separator",
			{
				label: "Filter by Column",
				action: () => {
					gridStore.setFilter(props.tabId, {
						column,
						operator: "isNotNull",
						value: "",
					});
				},
			},
		];
	};

	return (
		<div
			ref={gridRef}
			class="data-grid"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onContextMenu={handleGridContextMenu}
		>
			<Show when={tab()}>
				{(tabState) => (
					<Show when={tabState().fkNavigationHistory.length > 0}>
						<div class="data-grid__breadcrumb">
							<button
								class="data-grid__breadcrumb-back"
								onClick={handleFkBack}
								title="Go back"
							>
								<Icon name="arrow-left" size={12} />
							</button>
							<For each={tabState().fkNavigationHistory}>
								{(entry) => (
									<>
										<span class="data-grid__breadcrumb-item">{entry.table}</span>
										<span class="data-grid__breadcrumb-sep">&#8250;</span>
									</>
								)}
							</For>
							<span class="data-grid__breadcrumb-current">{currentTable()}</span>
						</div>
					</Show>
				)}
			</Show>

			<div class="data-grid__toolbar">
				<Show when={tab()}>
					{(tabState) => (
						<>
							<div class="data-grid__view-actions">
								<Show
									when={hasActiveView()}
									fallback={
										<button
											class="data-grid__toolbar-btn"
											onClick={() => {
												setSaveViewForceNew(false);
												setSaveViewOpen(true);
											}}
											title="Save current view"
										>
											<Icon name="save" size={12} /> Save View
										</button>
									}
								>
									<button
										class="data-grid__toolbar-btn"
										onClick={handleQuickSave}
										title="Save view (Ctrl+S)"
									>
										<Icon name="save" size={12} /> Save
									</button>
									<Show when={isModified()}>
										<button
											class="data-grid__toolbar-btn"
											onClick={handleResetView}
											title="Reset to saved state"
										>
											<RotateCcw size={12} /> Reset
										</button>
										<button
											class="data-grid__toolbar-btn"
											onClick={handleSaveAsNew}
											title="Save as new view"
										>
											<Save size={12} /> Save As...
										</button>
									</Show>
								</Show>
							</div>
							<div
								class="data-grid__quick-search"
								classList={{ "data-grid__quick-search--active": searchInput().length > 0 }}
							>
								<Icon name="search" size={12} />
								<input
									type="text"
									class="data-grid__quick-search-input"
									placeholder="Search..."
									value={searchInput()}
									onInput={(e) => handleQuickSearchInput(e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape" && searchInput()) {
											e.preventDefault();
											e.stopPropagation();
											handleClearQuickSearch();
										}
									}}
								/>
								<Show when={searchInput()}>
									<button
										class="data-grid__quick-search-clear"
										onClick={handleClearQuickSearch}
										title="Clear search"
									>
										<Icon name="close" size={10} />
									</button>
								</Show>
							</div>
							<FilterBar
								columns={tabState().columns}
								filters={tabState().filters}
								onAddFilter={handleAddFilter}
								onRemoveFilter={handleRemoveFilter}
								onClearAll={handleClearFilters}
							/>
							<ColumnManager
								columns={tabState().columns}
								columnConfig={tabState().columnConfig}
								columnOrder={tabState().columnOrder}
								onToggleVisibility={(col, visible) =>
									gridStore.setColumnVisibility(props.tabId, col, visible)
								}
								onTogglePin={(col, pinned) =>
									gridStore.setColumnPinned(props.tabId, col, pinned)
								}
								onReorder={(order) =>
									gridStore.setColumnOrder(props.tabId, order)
								}
								onReset={() => gridStore.resetColumnConfig(props.tabId)}
							/>
							<button
								class="data-grid__toolbar-btn"
								onClick={() => setExportOpen(true)}
								title="Export data"
							>
								<Icon name="export" size={12} /> Export
							</button>
							<Show when={!isReadOnly()}>
								<button
									class="data-grid__toolbar-btn"
									onClick={() => setImportOpen(true)}
									title="Import data"
								>
									<Icon name="import" size={12} /> Import
								</button>
							</Show>
							<button
								class="data-grid__toolbar-btn"
								onClick={() => {
									window.dispatchEvent(new CustomEvent("dotaz:open-compare", {
										detail: {
											connectionId: props.connectionId,
											schema: currentSchema(),
											table: currentTable(),
											database: props.database,
										},
									}));
								}}
								title="Compare this table with another"
							>
								<Icon name="compare" size={12} /> Compare
							</button>
							<button
								class="data-grid__toolbar-btn"
								onClick={() => {
									tabsStore.openTab({
										type: "schema-viewer",
										title: `Schema — ${currentTable()}`,
										connectionId: props.connectionId,
										schema: currentSchema(),
										table: currentTable(),
										database: props.database,
									});
								}}
								title="View table schema"
							>
								<Icon name="schema" size={12} /> Schema
							</button>
							<button
								class="data-grid__toolbar-btn"
								classList={{ "data-grid__toolbar-btn--active": !!tabState().transposed }}
								onClick={() => gridStore.toggleTranspose(props.tabId)}
								title="Transpose view (Ctrl+Shift+T)"
							>
								<ArrowLeftRight size={12} /> Transpose
							</button>
							<button
								class="data-grid__toolbar-btn"
								classList={{ "data-grid__toolbar-btn--active": !!tabState().valueEditorOpen }}
								onClick={() => gridStore.toggleValueEditor(props.tabId)}
								title="Value editor panel (Ctrl+Shift+E)"
							>
								<PanelRightOpen size={12} /> Value
							</button>
							<button
								class="data-grid__toolbar-btn"
								onClick={handleRefresh}
								disabled={tabState().loading}
								title="Refresh data (F5)"
							>
								<Icon name={tabState().loading ? "spinner" : "refresh"} size={12} /> Refresh
							</button>
						</>
					)}
				</Show>
			</div>

			<Show when={tab()}>
				{(tabState) => (
					<>
						<div class="data-grid__body">
							<div class="data-grid__main">
								<Show when={tabState().loading && tabState().rows.length === 0}>
									<div class="data-grid__skeleton">
										<div class="data-grid__skeleton-header">
											<div class="skeleton" style={{ width: "80px", height: "14px" }} />
											<div class="skeleton" style={{ width: "120px", height: "14px" }} />
											<div class="skeleton" style={{ width: "100px", height: "14px" }} />
											<div class="skeleton" style={{ width: "90px", height: "14px" }} />
											<div class="skeleton" style={{ width: "110px", height: "14px" }} />
										</div>
										{Array.from({ length: 8 }).map(() => (
											<div class="data-grid__skeleton-row">
												<div class="skeleton" style={{ width: "70px", height: "12px" }} />
												<div class="skeleton" style={{ width: "110px", height: "12px" }} />
												<div class="skeleton" style={{ width: "90px", height: "12px" }} />
												<div class="skeleton" style={{ width: "80px", height: "12px" }} />
												<div class="skeleton" style={{ width: "100px", height: "12px" }} />
											</div>
										))}
									</div>
								</Show>

								<div
									ref={scrollRef}
									class="data-grid__table-container"
									classList={{ "data-grid__table-container--loading": tabState().loading }}
								>
									<Show
										when={tabState().transposed}
										fallback={
											<>
												<GridHeader
													columns={visibleColumns()}
													sort={tabState().sort}
													columnConfig={tabState().columnConfig}
													pinStyles={pinStyles()}
													fkColumns={fkColumns()}
													onToggleSort={handleToggleSort}
													onResizeColumn={handleResizeColumn}
													onHeaderContextMenu={handleHeaderContextMenu}
												/>

												<VirtualScroller
													scrollElement={() => scrollRef}
													rows={tabState().rows}
													columns={visibleColumns()}
													columnConfig={tabState().columnConfig}
													pinStyles={pinStyles()}
													selectedRows={tabState().selectedRows}
													scrollMargin={HEADER_HEIGHT}
													onRowClick={handleRowClick}
													onRowDblClick={handleRowDblClick}
													editingCell={tabState().editingCell}
													getChangedCells={getChangedCells}
													isRowDeleted={(idx) => gridStore.isRowDeleted(props.tabId, idx)}
													isRowNew={(idx) => gridStore.isRowNew(props.tabId, idx)}
													fkMap={fkMap()}
													onCellSave={handleCellSave}
													onCellCancel={handleCellCancel}
													onCellMoveNext={handleCellMoveNext}
													onCellMoveDown={handleCellMoveDown}
													onFkClick={handleFkClick}
												/>
											</>
										}
									>
										<TransposedGrid
											rows={tabState().rows}
											columns={visibleColumns()}
											columnConfig={tabState().columnConfig}
											selectedRows={tabState().selectedRows}
											onRowClick={handleRowClick}
											onRowDblClick={handleRowDblClick}
											editingCell={tabState().editingCell}
											getChangedCells={getChangedCells}
											isRowDeleted={(idx) => gridStore.isRowDeleted(props.tabId, idx)}
											isRowNew={(idx) => gridStore.isRowNew(props.tabId, idx)}
											fkMap={fkMap()}
											onCellSave={handleCellSave}
											onCellCancel={handleCellCancel}
											onCellMoveNext={handleCellMoveNext}
											onCellMoveDown={handleCellMoveDown}
											onFkClick={handleFkClick}
										/>
									</Show>

									<Show when={!tabState().loading && tabState().rows.length === 0}>
										<div class="empty-state" style={{ "padding-top": "48px" }}>
											<Icon name="table" size={32} class="empty-state__icon" />
											<div class="empty-state__title">No data</div>
											<div class="empty-state__subtitle">
												{tabState().quickSearch
													? "No rows match the current search."
													: tabState().filters.length > 0
														? "No rows match the current filters."
														: "This table is empty."}
											</div>
										</div>
									</Show>
								</div>
							</div>

							<Show when={tabState().valueEditorOpen && tabState().focusedCell}>
								{(_) => {
									const focused = () => tabState().focusedCell!;
									const col = () => visibleColumns().find((c) => c.name === focused().column) ?? tabState().columns.find((c) => c.name === focused().column);
									const cellValue = () => tabState().rows[focused().row]?.[focused().column];
									return (
										<Show when={col()}>
											{(column) => (
												<ValueEditorPanel
													value={cellValue()}
													column={column()}
													rowIndex={focused().row}
													width={tabState().valueEditorWidth}
													readOnly={isReadOnly()}
													onSave={(value) => {
														gridStore.setCellValue(props.tabId, focused().row, focused().column, value);
													}}
													onResize={(delta) => {
														gridStore.setValueEditorWidth(props.tabId, tabState().valueEditorWidth + delta);
													}}
													onClose={() => gridStore.toggleValueEditor(props.tabId)}
												/>
											)}
										</Show>
									);
								}}
							</Show>
						</div>

						<Show when={tabState().selectedRows.size >= 2}>
							{(_) => {
								const cellData = () => gridStore.getSelectedCellData(props.tabId);
								return (
									<Show when={cellData()}>
										{(data) => (
											<AggregatePanel
												rows={data().rows}
												columns={data().columns}
												visibleColumns={visibleColumns()}
											/>
										)}
									</Show>
								);
							}}
						</Show>

						<Show when={showPendingPanel() && gridStore.hasPendingChanges(props.tabId)}>
							<PendingChanges
								tabId={props.tabId}
								connectionId={props.connectionId}
								database={props.database}
								onApplied={handleChangesApplied}
							/>
						</Show>

						<div class="data-grid__footer">
							<Pagination
								currentPage={tabState().currentPage}
								pageSize={tabState().pageSize}
								totalCount={tabState().totalCount}
								loading={tabState().loading}
								onPageChange={(page) => gridStore.setPage(props.tabId, page)}
								onPageSizeChange={(size) => gridStore.setPageSize(props.tabId, size)}
							/>
							<Show when={staleLabel()}>
								{(label) => (
									<span class="data-grid__stale-indicator" title="Press F5 to refresh">{label()}</span>
								)}
							</Show>
							<Show when={gridStore.hasPendingChanges(props.tabId)}>
								<button
									class="data-grid__pending-badge"
									onClick={() => setShowPendingPanel((prev) => !prev)}
									title="Toggle pending changes panel"
								>
									<Pencil size={12} /> {gridStore.pendingChangesCount(props.tabId)} pending change{gridStore.pendingChangesCount(props.tabId) !== 1 ? "s" : ""}
								</button>
							</Show>
						</div>
					</>
				)}
			</Show>

			<Show when={copyFeedback()}>
				<div class="data-grid__copy-toast">{copyFeedback()}</div>
			</Show>

			<Show when={rowDetailIndex() !== null}>
				{(_) => {
					const t = tab()!;
					return (
						<RowDetailDialog
							open={true}
							tabId={props.tabId}
							connectionId={props.connectionId}
							schema={currentSchema()}
							table={currentTable()}
							database={props.database}
							columns={t.columns}
							rows={t.rows}
							rowIndex={rowDetailIndex()!}
							foreignKeys={foreignKeys()}
							pendingCellEdits={t.pendingChanges.cellEdits}
							onSave={handleRowDetailSave}
							onClose={handleRowDetailClose}
							onNavigate={handleRowDetailNavigate}
							onNavigateToTable={(schema, table, filters) => {
								setRowDetailIndex(null);
								gridStore.navigateToTableWithFilters(
									props.tabId, schema, table, filters,
								);
								tabsStore.renameTab(props.tabId, table);
							}}
						/>
					);
				}}
			</Show>

			<SaveViewDialog
				open={saveViewOpen()}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				initialName={hasActiveView() ? undefined : generateAutoName()}
				forceNew={saveViewForceNew()}
				onClose={() => setSaveViewOpen(false)}
				onSaved={async (viewId, viewName, config) => {
					tabsStore.setTabView(props.tabId, viewId, viewName);
					gridStore.setActiveView(props.tabId, viewId, viewName);
					setSavedViewConfig(config);
					await viewsStore.refreshViews(props.connectionId);
				}}
			/>

			<ExportDialog
				open={exportOpen()}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				onClose={() => setExportOpen(false)}
			/>

			<ImportDialog
				open={importOpen()}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				onClose={() => setImportOpen(false)}
				onImported={() => {
					gridStore.refreshData(props.tabId);
				}}
			/>

			<Show when={cellContextMenu()}>
				{(ctx) => (
					<ContextMenu
						x={ctx().x}
						y={ctx().y}
						items={cellContextMenuItems()}
						onClose={closeContextMenus}
					/>
				)}
			</Show>

			<Show when={headerContextMenu()}>
				{(ctx) => (
					<ContextMenu
						x={ctx().x}
						y={ctx().y}
						items={headerContextMenuItems()}
						onClose={closeContextMenus}
					/>
				)}
			</Show>
		</div>
	);
}
