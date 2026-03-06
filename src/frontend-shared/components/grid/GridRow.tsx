import { For } from 'solid-js'
import type { GridColumnDef } from '../../../shared/types/grid'
import { DEFAULT_COLUMN_WIDTH } from '../../lib/layout-constants'
import type { ColumnConfig, EditingCell, FkTarget, HeatmapInfo } from '../../stores/grid'
import { gridStore } from '../../stores/grid'
import GridCell from './GridCell'
import './GridRow.css'

interface GridRowProps {
	row: Record<string, unknown>
	index: number
	columns: GridColumnDef[]
	columnConfig: Record<string, ColumnConfig>
	pinStyles: Map<string, Record<string, string>>
	isCellSelected: (colIndex: number) => boolean
	focusedColIndex: number | null
	onClick: (index: number, e: MouseEvent) => void
	onDblClick?: (index: number, e: MouseEvent) => void
	onRowNumberClick?: (index: number, e: MouseEvent) => void
	style?: Record<string, string>
	editingCell?: EditingCell | null
	changedCells?: Set<string>
	isDeleted?: boolean
	isNewRow?: boolean
	fkMap?: Map<string, FkTarget>
	heatmapInfo?: Map<string, HeatmapInfo>
	onCellSave?: (column: string, value: unknown) => void
	onCellCancel?: () => void
	onCellMoveNext?: (column: string) => void
	onCellMoveDown?: (column: string) => void
	onFkClick?: (column: string) => void
}

function getColumnWidth(col: string, config: Record<string, ColumnConfig>): number {
	return config[col]?.width ?? DEFAULT_COLUMN_WIDTH
}

export default function GridRow(props: GridRowProps) {
	function handleClick(e: MouseEvent) {
		props.onClick(props.index, e)
	}

	function handleDblClick(e: MouseEvent) {
		props.onDblClick?.(props.index, e)
	}

	function handleRowNumberClick(e: MouseEvent) {
		e.stopPropagation()
		props.onRowNumberClick?.(props.index, e)
	}

	// Check if any cell in this row is selected
	const hasAnySelection = () => {
		for (let i = 0; i < props.columns.length; i++) {
			if (props.isCellSelected(i)) return true
		}
		return false
	}

	return (
		<div
			class="grid-row"
			classList={{
				'grid-row--even': props.index % 2 === 0,
				'grid-row--odd': props.index % 2 !== 0,
				'grid-row--deleted': !!props.isDeleted,
				'grid-row--new': !!props.isNewRow,
			}}
			data-row-index={props.index}
			style={props.style}
			onClick={handleClick}
			onDblClick={handleDblClick}
		>
			<div
				class="grid-row-number"
				classList={{ 'grid-row-number--selected': hasAnySelection() }}
				onClick={handleRowNumberClick}
			>
				{props.index + 1}
			</div>
			<For each={props.columns}>
				{(col, colIdx) => {
					const isEditing = () =>
						props.editingCell?.row === props.index
						&& props.editingCell?.column === col.name
					const isChanged = () => props.changedCells?.has(col.name) ?? false
					const isSelected = () => props.isCellSelected(colIdx())
					const isFocused = () => props.focusedColIndex === colIdx()
					const heatmapColor = () => {
						const info = props.heatmapInfo?.get(col.name)
						return info ? gridStore.computeHeatmapColor(props.row[col.name], info) : undefined
					}

					return (
						<GridCell
							value={props.row[col.name]}
							column={col}
							width={getColumnWidth(col.name, props.columnConfig)}
							pinStyle={props.pinStyles.get(col.name)}
							editing={isEditing()}
							changed={isChanged()}
							selected={isSelected()}
							focused={isFocused()}
							deleted={props.isDeleted}
							newRow={props.isNewRow}
							fkTarget={props.fkMap?.get(col.name)}
							heatmapColor={heatmapColor()}
							onSave={(value) => props.onCellSave?.(col.name, value)}
							onCancel={() => props.onCellCancel?.()}
							onMoveNext={() => props.onCellMoveNext?.(col.name)}
							onMoveDown={() => props.onCellMoveDown?.(col.name)}
							onFkClick={props.fkMap?.has(col.name) ? () => props.onFkClick?.(col.name) : undefined}
						/>
					)
				}}
			</For>
		</div>
	)
}
