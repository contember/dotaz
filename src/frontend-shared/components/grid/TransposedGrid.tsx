import { For, Show } from 'solid-js'
import type { GridColumnDef } from '../../../shared/types/grid'
import { getDataTypeLabel } from '../../lib/column-types'
import { DEFAULT_COLUMN_WIDTH } from '../../lib/layout-constants'
import type { ColumnConfig, EditingCell, FkTarget, HeatmapInfo } from '../../stores/grid'
import { gridStore } from '../../stores/grid'
import GridCell from './GridCell'
import './TransposedGrid.css'

interface TransposedGridProps {
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]
	columnConfig: Record<string, ColumnConfig>
	selectedRows: Set<number>
	onRowClick: (index: number, e: MouseEvent) => void
	onRowDblClick?: (index: number, e: MouseEvent) => void
	editingCell?: EditingCell | null
	getChangedCells?: (rowIndex: number) => Set<string>
	isRowDeleted?: (rowIndex: number) => boolean
	isRowNew?: (rowIndex: number) => boolean
	fkMap?: Map<string, FkTarget>
	heatmapInfo?: Map<string, HeatmapInfo>
	onCellSave?: (rowIndex: number, column: string, value: unknown) => void
	onCellCancel?: () => void
	onCellMoveNext?: (rowIndex: number, column: string) => void
	onCellMoveDown?: (rowIndex: number, column: string) => void
	onFkClick?: (rowIndex: number, column: string) => void
}

/** Width of the row-header (column name) column in transposed view. */
const HEADER_COL_WIDTH = 180

export default function TransposedGrid(props: TransposedGridProps) {
	return (
		<div class="transposed-grid">
			{/* Header row: row-header label + one column per original row */}
			<div class="transposed-grid__header-row">
				<div
					class="transposed-grid__corner"
					style={{ width: `${HEADER_COL_WIDTH}px` }}
				>
					Column
				</div>
				<For each={props.rows}>
					{(_, rowIdx) => (
						<div
							class="transposed-grid__col-header"
							classList={{
								'transposed-grid__col-header--selected': props.selectedRows.has(rowIdx()),
							}}
							style={{ width: `${DEFAULT_COLUMN_WIDTH}px` }}
							onClick={(e) => props.onRowClick(rowIdx(), e)}
						>
							Row {rowIdx() + 1}
						</div>
					)}
				</For>
			</div>

			{/* One row per original column */}
			<For each={props.columns}>
				{(col) => (
					<div
						class="transposed-grid__row"
						classList={{
							'transposed-grid__row--even': props.columns.indexOf(col) % 2 === 0,
							'transposed-grid__row--odd': props.columns.indexOf(col) % 2 !== 0,
						}}
					>
						{/* Sticky row header with column name + type badge */}
						<div
							class="transposed-grid__row-header"
							style={{ width: `${HEADER_COL_WIDTH}px` }}
							title={`${col.name} (${col.dataType})`}
						>
							<span class="transposed-grid__type-badge">
								{getDataTypeLabel(col.dataType)}
							</span>
							<span class="transposed-grid__col-name">{col.name}</span>
							<span class="transposed-grid__col-icons">
								<Show when={col.isPrimaryKey}>
									<span class="transposed-grid__icon-pk">PK</span>
								</Show>
								<Show when={col.nullable}>
									<span class="transposed-grid__icon-nullable">?</span>
								</Show>
							</span>
						</div>

						{/* One cell per original row */}
						<For each={props.rows}>
							{(row, rowIdx) => {
								const isEditing = () =>
									props.editingCell?.row === rowIdx()
									&& props.editingCell?.column === col.name
								const isChanged = () => props.getChangedCells?.(rowIdx())?.has(col.name) ?? false
								const heatmapColor = () => {
									const info = props.heatmapInfo?.get(col.name)
									return info ? gridStore.computeHeatmapColor(row[col.name], info) : undefined
								}

								return (
									<div
										class="transposed-grid__cell-wrapper"
										classList={{
											'transposed-grid__cell-wrapper--selected': props.selectedRows.has(rowIdx()),
										}}
										data-column={col.name}
										onClick={(e) => props.onRowClick(rowIdx(), e)}
										onDblClick={(e) => props.onRowDblClick?.(rowIdx(), e)}
									>
										<GridCell
											value={row[col.name]}
											column={col}
											width={DEFAULT_COLUMN_WIDTH}
											editing={isEditing()}
											changed={isChanged()}
											deleted={props.isRowDeleted?.(rowIdx())}
											newRow={props.isRowNew?.(rowIdx())}
											fkTarget={props.fkMap?.get(col.name)}
											heatmapColor={heatmapColor()}
											onSave={(value) => props.onCellSave?.(rowIdx(), col.name, value)}
											onCancel={() => props.onCellCancel?.()}
											onMoveNext={() => props.onCellMoveNext?.(rowIdx(), col.name)}
											onMoveDown={() => props.onCellMoveDown?.(rowIdx(), col.name)}
											onFkClick={props.fkMap?.has(col.name) ? () => props.onFkClick?.(rowIdx(), col.name) : undefined}
										/>
									</div>
								)
							}}
						</For>
					</div>
				)}
			</For>
		</div>
	)
}
