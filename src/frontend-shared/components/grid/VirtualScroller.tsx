import { createSignal, For, onMount, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { GridColumnDef } from "../../../shared/types/grid";
import type { ColumnConfig, EditingCell, FkTarget } from "../../stores/grid";
import GridRow from "./GridRow";
import { ROW_HEIGHT } from "../../lib/layout-constants";
import "./VirtualScroller.css";

const OVERSCAN = 5;

interface VirtualScrollerProps {
	scrollElement: () => HTMLElement | undefined;
	rows: Record<string, unknown>[];
	columns: GridColumnDef[];
	columnConfig: Record<string, ColumnConfig>;
	pinStyles: Map<string, Record<string, string>>;
	selectedRows: Set<number>;
	scrollMargin: number;
	onRowClick: (index: number, e: MouseEvent) => void;
	onRowDblClick?: (index: number, e: MouseEvent) => void;
	editingCell?: EditingCell | null;
	getChangedCells?: (rowIndex: number) => Set<string>;
	isRowDeleted?: (rowIndex: number) => boolean;
	isRowNew?: (rowIndex: number) => boolean;
	fkMap?: Map<string, FkTarget>;
	onCellSave?: (rowIndex: number, column: string, value: unknown) => void;
	onCellCancel?: () => void;
	onCellMoveNext?: (rowIndex: number, column: string) => void;
	onCellMoveDown?: (rowIndex: number, column: string) => void;
	onFkClick?: (rowIndex: number, column: string) => void;
}

export default function VirtualScroller(props: VirtualScrollerProps) {
	// Defer scroll element until mounted so the virtualizer doesn't try to
	// measure a disconnected element (offsetHeight would be 0).  Without this,
	// createComputed inside createVirtualizer runs before onMount and sets up
	// observers on a not-yet-connected DOM node whose ResizeObserver may never
	// fire in some webview runtimes (Electrobun/GTK).
	const [mounted, setMounted] = createSignal(false);
	onMount(() => setMounted(true));

	const virtualizer = createVirtualizer({
		get count() {
			return props.rows.length;
		},
		getScrollElement: () => (mounted() ? props.scrollElement() : undefined) ?? null,
		estimateSize: () => ROW_HEIGHT,
		overscan: OVERSCAN,
		get scrollMargin() {
			return props.scrollMargin;
		},
	});

	return (
		<div
			class="virtual-scroller"
			style={{ height: `${virtualizer.getTotalSize()}px` }}
		>
			<Show when={props.rows.length === 0}>
				<div class="virtual-scroller__empty">No data</div>
			</Show>

			<For each={virtualizer.getVirtualItems()}>
				{(virtualRow) => (
					<Show when={props.rows[virtualRow.index]}>
					<GridRow
						row={props.rows[virtualRow.index]}
						index={virtualRow.index}
						columns={props.columns}
						columnConfig={props.columnConfig}
						pinStyles={props.pinStyles}
						selected={props.selectedRows.has(virtualRow.index)}
						onClick={props.onRowClick}
						onDblClick={props.onRowDblClick}
						editingCell={props.editingCell}
						changedCells={props.getChangedCells?.(virtualRow.index)}
						isDeleted={props.isRowDeleted?.(virtualRow.index)}
						isNewRow={props.isRowNew?.(virtualRow.index)}
						fkMap={props.fkMap}
						onCellSave={(col, val) => props.onCellSave?.(virtualRow.index, col, val)}
						onCellCancel={props.onCellCancel}
						onCellMoveNext={(col) => props.onCellMoveNext?.(virtualRow.index, col)}
						onCellMoveDown={(col) => props.onCellMoveDown?.(virtualRow.index, col)}
						onFkClick={(col) => props.onFkClick?.(virtualRow.index, col)}
						style={{
							position: "absolute",
							top: `${virtualRow.start - virtualizer.options.scrollMargin}px`,
							left: "0",
							width: "100%",
							height: `${virtualRow.size}px`,
						}}
					/>
					</Show>
				)}
			</For>
		</div>
	);
}
