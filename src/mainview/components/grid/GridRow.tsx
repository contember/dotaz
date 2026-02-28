import { For } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import type { ColumnConfig, EditingCell, FkTarget } from "../../stores/grid";
import GridCell from "./GridCell";
import "./GridRow.css";

interface GridRowProps {
	row: Record<string, unknown>;
	index: number;
	columns: GridColumnDef[];
	columnConfig: Record<string, ColumnConfig>;
	pinStyles: Map<string, Record<string, string>>;
	selected: boolean;
	onClick: (index: number, e: MouseEvent) => void;
	onDblClick?: (index: number, e: MouseEvent) => void;
	style?: Record<string, string>;
	editingCell?: EditingCell | null;
	changedCells?: Set<string>;
	isDeleted?: boolean;
	isNewRow?: boolean;
	fkMap?: Map<string, FkTarget>;
	onCellSave?: (column: string, value: unknown) => void;
	onCellCancel?: () => void;
	onCellMoveNext?: (column: string) => void;
	onCellMoveDown?: (column: string) => void;
	onFkClick?: (column: string) => void;
}

const DEFAULT_COLUMN_WIDTH = 150;

function getColumnWidth(col: string, config: Record<string, ColumnConfig>): number {
	return config[col]?.width ?? DEFAULT_COLUMN_WIDTH;
}

export default function GridRow(props: GridRowProps) {
	function handleClick(e: MouseEvent) {
		props.onClick(props.index, e);
	}

	function handleDblClick(e: MouseEvent) {
		props.onDblClick?.(props.index, e);
	}

	return (
		<div
			class="grid-row"
			classList={{
				"grid-row--selected": props.selected,
				"grid-row--even": props.index % 2 === 0,
				"grid-row--odd": props.index % 2 !== 0,
				"grid-row--deleted": !!props.isDeleted,
				"grid-row--new": !!props.isNewRow,
			}}
			style={props.style}
			onClick={handleClick}
			onDblClick={handleDblClick}
		>
			<For each={props.columns}>
				{(col) => {
					const isEditing = () =>
						props.editingCell?.row === props.index &&
						props.editingCell?.column === col.name;
					const isChanged = () => props.changedCells?.has(col.name) ?? false;

					return (
						<GridCell
							value={props.row[col.name]}
							column={col}
							width={getColumnWidth(col.name, props.columnConfig)}
							pinStyle={props.pinStyles.get(col.name)}
							editing={isEditing()}
							changed={isChanged()}
							deleted={props.isDeleted}
							newRow={props.isNewRow}
							fkTarget={props.fkMap?.get(col.name)}
							onSave={(value) => props.onCellSave?.(col.name, value)}
							onCancel={() => props.onCellCancel?.()}
							onMoveNext={() => props.onCellMoveNext?.(col.name)}
							onMoveDown={() => props.onCellMoveDown?.(col.name)}
							onFkClick={props.fkMap?.has(col.name) ? () => props.onFkClick?.(col.name) : undefined}
						/>
					);
				}}
			</For>
		</div>
	);
}
