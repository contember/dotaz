import { createEffect, createSignal, onMount, Show } from "solid-js";
import type { ColumnFilter } from "../../../shared/types/grid";
import type { ForeignKeyInfo } from "../../../shared/types/database";
import { gridStore } from "../../stores/grid";
import { tabsStore } from "../../stores/tabs";
import { rpc } from "../../lib/rpc";
import { createKeyHandler } from "../../lib/keyboard";
import GridHeader from "./GridHeader";
import VirtualScroller from "./VirtualScroller";
import FilterBar from "./FilterBar";
import ColumnManager from "./ColumnManager";
import Pagination from "./Pagination";
import RowDetailDialog from "../edit/RowDetailDialog";
import PendingChanges from "../edit/PendingChanges";
import SavedViewPicker from "../views/SavedViewPicker";
import SaveViewDialog from "../views/SaveViewDialog";
import "./DataGrid.css";

interface DataGridProps {
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
}

const HEADER_HEIGHT = 34; // 32px height + 2px border
const COPY_FLASH_DURATION = 400;

export default function DataGrid(props: DataGridProps) {
	const [fkColumns, setFkColumns] = createSignal<Set<string>>(new Set());
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([]);
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);
	const [rowDetailIndex, setRowDetailIndex] = createSignal<number | null>(null);
	const [showPendingPanel, setShowPendingPanel] = createSignal(false);
	const [saveViewOpen, setSaveViewOpen] = createSignal(false);
	let scrollRef: HTMLDivElement | undefined;
	let gridRef: HTMLDivElement | undefined;
	let anchorRow = -1;

	const tab = () => gridStore.getTab(props.tabId);

	// Sync tab dirty flag with pending changes state
	createEffect(() => {
		const dirty = gridStore.hasPendingChanges(props.tabId);
		tabsStore.setTabDirty(props.tabId, dirty);
		// Auto-hide panel when no pending changes
		if (!dirty) setShowPendingPanel(false);
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
			gridStore.loadTableData(props.tabId, props.connectionId, props.schema, props.table);
		}

		try {
			const fks = await rpc.schema.getForeignKeys(
				props.connectionId,
				props.schema,
				props.table,
			);
			setForeignKeys(fks);
			const fkCols = new Set<string>();
			for (const fk of fks) {
				for (const col of fk.columns) {
					fkCols.add(col);
				}
			}
			setFkColumns(fkCols);
		} catch {
			// FK info is non-critical
		}
	});

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
		const target = e.target as HTMLElement;
		const cellEl = target.closest<HTMLElement>("[data-column]");
		const columnName = cellEl?.dataset.column;
		if (columnName && !gridStore.isRowDeleted(props.tabId, index)) {
			gridStore.startEditing(props.tabId, index, columnName);
		}
	}

	function startEditingFocused() {
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
		const newIndex = gridStore.addNewRow(props.tabId);
		const cols = visibleColumns();
		if (cols.length > 0) {
			gridStore.startEditing(props.tabId, newIndex, cols[0].name);
			gridStore.setFocusedCell(props.tabId, { row: newIndex, column: cols[0].name });
		}
	}

	function handleDeleteSelected() {
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
		gridStore.loadTableData(props.tabId, props.connectionId, props.schema, props.table);
	}

	// ── Saved views ────────────────────────────────────────

	async function handleQuickSave() {
		const t = tab();
		if (!t?.activeViewId) {
			setSaveViewOpen(true);
			return;
		}
		try {
			const config = gridStore.captureViewConfig(props.tabId);
			await rpc.views.update({
				id: t.activeViewId,
				name: t.activeViewName!,
				config,
			});
		} catch {
			// Fall back to dialog on error
			setSaveViewOpen(true);
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

	return (
		<div
			ref={gridRef}
			class="data-grid"
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			<div class="data-grid__toolbar">
				<Show when={tab()}>
					{(tabState) => (
						<>
							<SavedViewPicker
								tabId={props.tabId}
								connectionId={props.connectionId}
								schema={props.schema}
								table={props.table}
								onSaveView={() => setSaveViewOpen(true)}
							/>
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
						</>
					)}
				</Show>
			</div>

			<Show when={tab()}>
				{(tabState) => (
					<>
						<Show when={tabState().loading}>
							<div class="data-grid__loading">
								<div class="data-grid__spinner" />
								Loading...
							</div>
						</Show>

						<div
							ref={scrollRef}
							class="data-grid__table-container"
							classList={{ "data-grid__table-container--loading": tabState().loading }}
						>
							<GridHeader
								columns={visibleColumns()}
								sort={tabState().sort}
								columnConfig={tabState().columnConfig}
								pinStyles={pinStyles()}
								fkColumns={fkColumns()}
								onToggleSort={handleToggleSort}
								onResizeColumn={handleResizeColumn}
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
								onCellSave={handleCellSave}
								onCellCancel={handleCellCancel}
								onCellMoveNext={handleCellMoveNext}
								onCellMoveDown={handleCellMoveDown}
							/>
						</div>

						<Show when={showPendingPanel() && gridStore.hasPendingChanges(props.tabId)}>
							<PendingChanges
								tabId={props.tabId}
								connectionId={props.connectionId}
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
							<Show when={gridStore.hasPendingChanges(props.tabId)}>
								<button
									class="data-grid__pending-badge"
									onClick={() => setShowPendingPanel((prev) => !prev)}
									title="Toggle pending changes panel"
								>
									{gridStore.pendingChangesCount(props.tabId)} pending change{gridStore.pendingChangesCount(props.tabId) !== 1 ? "s" : ""}
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
							columns={t.columns}
							rows={t.rows}
							rowIndex={rowDetailIndex()!}
							foreignKeys={foreignKeys()}
							pendingCellEdits={t.pendingChanges.cellEdits}
							onSave={handleRowDetailSave}
							onClose={handleRowDetailClose}
							onNavigate={handleRowDetailNavigate}
						/>
					);
				}}
			</Show>

			<SaveViewDialog
				open={saveViewOpen()}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={props.schema}
				table={props.table}
				onClose={() => setSaveViewOpen(false)}
				onSaved={() => {
					// Dialog closes itself; picker will reload on next open
				}}
			/>
		</div>
	);
}
