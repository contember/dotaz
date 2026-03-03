import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import { For, Show } from 'solid-js'
import type { GridColumnDef, SortColumn } from '../../../shared/types/grid'
import { getDataTypeLabel } from '../../lib/column-types'
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../../lib/layout-constants'
import type { ColumnConfig } from '../../stores/grid'
import './GridHeader.css'

interface GridHeaderProps {
	columns: GridColumnDef[]
	sort: SortColumn[]
	columnConfig: Record<string, ColumnConfig>
	pinStyles: Map<string, Record<string, string>>
	fkColumns: Set<string>
	onToggleSort: (column: string, multi: boolean) => void
	onResizeColumn: (column: string, width: number) => void
	onHeaderContextMenu?: (e: MouseEvent, column: string) => void
}

function getSortDirection(sort: SortColumn[], column: string): 'asc' | 'desc' | null {
	const s = sort.find((s) => s.column === column)
	return s?.direction ?? null
}

function getSortIndex(sort: SortColumn[], column: string): number {
	return sort.findIndex((s) => s.column === column)
}

export default function GridHeader(props: GridHeaderProps) {
	function handleHeaderClick(e: MouseEvent, column: string) {
		props.onToggleSort(column, e.shiftKey)
	}

	function handleResizeStart(e: MouseEvent, column: string) {
		e.preventDefault()
		e.stopPropagation()

		const startX = e.clientX
		const currentWidth = props.columnConfig[column]?.width ?? DEFAULT_COLUMN_WIDTH

		function onMouseMove(ev: MouseEvent) {
			const delta = ev.clientX - startX
			const newWidth = Math.max(MIN_COLUMN_WIDTH, currentWidth + delta)
			props.onResizeColumn(column, newWidth)
		}

		function onMouseUp() {
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mouseup', onMouseUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
			// Suppress the click event that the browser synthesizes after mouseup,
			// so it doesn't trigger column sorting on the parent header cell.
			document.addEventListener('click', suppressClick, true)
		}

		function suppressClick(ev: MouseEvent) {
			ev.stopPropagation()
			ev.preventDefault()
			document.removeEventListener('click', suppressClick, true)
		}

		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mouseup', onMouseUp)
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
	}

	function getColumnWidth(col: string): number {
		return props.columnConfig[col]?.width ?? DEFAULT_COLUMN_WIDTH
	}

	return (
		<div class="grid-header">
			<For each={props.columns}>
				{(col) => {
					const sortDir = () => getSortDirection(props.sort, col.name)
					const sortIdx = () => getSortIndex(props.sort, col.name)

					return (
						<div
							class="grid-header__cell"
							classList={{ 'grid-header__cell--pinned': props.pinStyles.has(col.name) }}
							style={{
								width: `${getColumnWidth(col.name)}px`,
								...props.pinStyles.get(col.name),
							}}
							onClick={(e) => handleHeaderClick(e, col.name)}
							onContextMenu={(e) => props.onHeaderContextMenu?.(e, col.name)}
						>
							<span class="grid-header__type-badge">
								{getDataTypeLabel(col.dataType)}
							</span>

							<span
								class="grid-header__name"
								title={`${col.name} (${col.dataType})`}
							>
								{col.name}
							</span>

							<Show when={sortDir()}>
								<span class="grid-header__sort-indicator">
									{sortDir() === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
									<Show when={props.sort.length > 1 && sortIdx() >= 0}>
										<span class="grid-header__sort-index">
											{sortIdx() + 1}
										</span>
									</Show>
								</span>
							</Show>

							<span class="grid-header__icons">
								<Show when={col.isPrimaryKey}>
									<span class="grid-header__icon-pk" title="Primary Key">
										PK
									</span>
								</Show>
								<Show when={props.fkColumns.has(col.name)}>
									<span class="grid-header__icon-fk" title="Foreign Key">
										FK
									</span>
								</Show>
								<Show when={col.nullable}>
									<span class="grid-header__icon-nullable" title="Nullable">
										?
									</span>
								</Show>
							</span>

							<div
								class="grid-header__resize-handle"
								onMouseDown={(e) => handleResizeStart(e, col.name)}
							/>
						</div>
					)
				}}
			</For>
		</div>
	)
}
