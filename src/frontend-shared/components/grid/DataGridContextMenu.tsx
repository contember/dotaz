import ArrowDown from 'lucide-solid/icons/arrow-down'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import Slash from 'lucide-solid/icons/ban'
import ClipboardCopy from 'lucide-solid/icons/clipboard-copy'
import ClipboardPaste from 'lucide-solid/icons/clipboard-paste'
import Copy from 'lucide-solid/icons/copy'
import CopyPlus from 'lucide-solid/icons/copy-plus'
import ExternalLink from 'lucide-solid/icons/external-link'
import EyeOff from 'lucide-solid/icons/eye-off'
import FilterIcon from 'lucide-solid/icons/funnel'
import FilterXIcon from 'lucide-solid/icons/funnel-x'
import Link from 'lucide-solid/icons/link'
import LinkIcon from 'lucide-solid/icons/link-2'
import PinLeft from 'lucide-solid/icons/panel-left-close'
import PanelRight from 'lucide-solid/icons/panel-right'
import PinRight from 'lucide-solid/icons/panel-right-close'
import PanelRightOpen from 'lucide-solid/icons/panel-right-open'
import Pencil from 'lucide-solid/icons/pencil'
import Rows3 from 'lucide-solid/icons/rows-3'
import Thermometer from 'lucide-solid/icons/thermometer'
import Trash2 from 'lucide-solid/icons/trash-2'
import Unlink from 'lucide-solid/icons/unlink'
import { createSignal, Show } from 'solid-js'
import { isNumericType } from '@dotaz/shared/column-types'
import { isJoinedColumn, parseJoinedColumn } from '@dotaz/shared/sql'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { FkTarget } from '../../stores/grid'
import { gridStore, isCellInSelection } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import type { ContextMenuEntry } from '../common/ContextMenu'
import ContextMenu from '../common/ContextMenu'

export interface DataGridContextMenuProps {
	tabId: string
	connectionId: string
	currentSchema: () => string
	currentTable: () => string
	database?: string
	fkMap: () => Map<string, FkTarget>
	visibleColumns: () => GridColumnDef[]
	isReadOnly: () => boolean
	onPaste: () => void
	onAdvancedCopy: () => void
	onDuplicateRow: (rowIndex: number) => void
	onFkClick: (rowIndex: number, column: string) => void
	onSetSidePanelOpen: (open: boolean) => void
}

export interface DataGridContextMenuHandle {
	handleGridContextMenu: (e: MouseEvent) => void
	handleHeaderContextMenu: (e: MouseEvent, column: string) => void
	closeContextMenus: () => void
}

export default function DataGridContextMenu(
	props: DataGridContextMenuProps & {
		ref?: (handle: DataGridContextMenuHandle) => void
	},
) {
	const [cellContextMenu, setCellContextMenu] = createSignal<
		{
			x: number
			y: number
			rowIndex: number
			column: string
		} | null
	>(null)

	const [headerContextMenu, setHeaderContextMenu] = createSignal<
		{
			x: number
			y: number
			column: string
		} | null
	>(null)

	const tab = () => gridStore.getTab(props.tabId)

	function handleGridContextMenu(e: MouseEvent) {
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		if (!cellEl) return
		const columnName = cellEl.dataset.column
		if (!columnName) return

		const rowEl = target.closest<HTMLElement>('[data-row-index]')
		if (!rowEl) return
		const rowIndex = Number(rowEl.dataset.rowIndex)
		if (Number.isNaN(rowIndex)) return

		e.preventDefault()
		setHeaderContextMenu(null)

		const t = tab()
		if (t) {
			const cols = props.visibleColumns()
			const colIdx = cols.findIndex((c) => c.name === columnName)
			if (colIdx >= 0 && !isCellInSelection(t.selection, rowIndex, colIdx)) {
				gridStore.selectCell(props.tabId, rowIndex, colIdx)
			}
		}

		setCellContextMenu({
			x: e.clientX,
			y: e.clientY,
			rowIndex,
			column: columnName,
		})
	}

	function handleHeaderContextMenu(e: MouseEvent, column: string) {
		e.preventDefault()
		setCellContextMenu(null)
		setHeaderContextMenu({
			x: e.clientX,
			y: e.clientY,
			column,
		})
	}

	function closeContextMenus() {
		setCellContextMenu(null)
		setHeaderContextMenu(null)
	}

	// Expose handle to parent
	props.ref?.({
		handleGridContextMenu,
		handleHeaderContextMenu,
		closeContextMenus,
	})

	function sortDescending(column: string) {
		const t = tab()
		const existing = t?.sort.find((s) => s.column === column)
		if (!existing || existing.direction === 'desc') {
			gridStore.toggleSort(props.tabId, column, false)
		}
		gridStore.toggleSort(props.tabId, column, false)
	}

	const cellContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = cellContextMenu()
		if (!ctx) return []
		const t = tab()
		if (!t) return []
		const { rowIndex, column } = ctx
		const row = t.rows[rowIndex]
		const value = row?.[column]
		const isDeleted = gridStore.isRowDeleted(props.tabId, rowIndex)

		const ro = props.isReadOnly()
		const currentSort = t.sort.find((s) => s.column === column)

		const items: ContextMenuEntry[] = [
			{ type: 'label', label: 'Clipboard' },
			{
				label: 'Copy Value',
				icon: () => <Copy size={14} />,
				action: async () => {
					await navigator.clipboard.writeText(
						gridStore.formatCellForClipboard(value),
					)
				},
			},
			{
				label: 'Copy Row',
				icon: () => <Rows3 size={14} />,
				action: async () => {
					const cols = props.visibleColumns()
					const header = cols.map((c) => c.name).join('\t')
					const rowText = cols
						.map((c) => gridStore.formatCellForClipboard(row[c.name]))
						.join('\t')
					await navigator.clipboard.writeText(`${header}\n${rowText}`)
				},
			},
			{
				label: 'Advanced Copy...',
				icon: () => <ClipboardCopy size={14} />,
				action: () => props.onAdvancedCopy(),
			},
			{
				label: 'Paste',
				icon: () => <ClipboardPaste size={14} />,
				action: () => props.onPaste(),
				disabled: isDeleted || ro,
			},
			'separator',
			{ type: 'label', label: 'Edit' },
			{
				label: 'Edit Cell',
				icon: () => <Pencil size={14} />,
				action: () => gridStore.startEditing(props.tabId, rowIndex, column),
				disabled: isDeleted || ro,
			},
			{
				label: 'Set NULL',
				icon: () => <Slash size={14} />,
				action: () => gridStore.setCellValue(props.tabId, rowIndex, column, null),
				disabled: isDeleted || ro,
			},
			'separator',
			{ type: 'label', label: 'Sort' },
			{
				type: 'button-row',
				buttons: [
					{
						label: 'Asc',
						icon: () => <ArrowUp size={14} />,
						active: currentSort?.direction === 'asc',
						action: () => gridStore.toggleSort(props.tabId, column, false),
					},
					{
						label: 'Desc',
						icon: () => <ArrowDown size={14} />,
						active: currentSort?.direction === 'desc',
						action: () => sortDescending(column),
					},
				],
			},
			'separator',
			{ type: 'label', label: 'Filter' },
			{
				type: 'button-row',
				buttons: [
					{
						label: value === null ? 'Is NULL' : 'Include',
						icon: () => <FilterIcon size={14} />,
						action: () => {
							const filterValue = value === null ? '' : String(value)
							const operator = value === null ? ('isNull' as const) : ('eq' as const)
							gridStore.setFilter(props.tabId, {
								column,
								operator,
								value: filterValue,
							})
						},
					},
					{
						label: value === null ? 'Not NULL' : 'Exclude',
						icon: () => <FilterXIcon size={14} />,
						action: () => {
							const filterValue = value === null ? '' : String(value)
							const operator = value === null ? ('isNotNull' as const) : ('neq' as const)
							gridStore.setFilter(props.tabId, {
								column,
								operator,
								value: filterValue,
							})
						},
					},
				],
			},
			'separator',
			{ type: 'label', label: 'Row' },
			{
				label: 'Row Detail',
				icon: () => <PanelRight size={14} />,
				action: () => {
					gridStore.selectFullRow(
						props.tabId,
						rowIndex,
						props.visibleColumns().length,
					)
					gridStore.closeFkPanel(props.tabId)
					props.onSetSidePanelOpen(true)
				},
			},
			{
				label: 'Open Row in Tab',
				icon: () => <ExternalLink size={14} />,
				action: () => {
					const pkCols = t.columns.filter((c) => c.isPrimaryKey)
					const pks: Record<string, unknown> = {}
					for (const pk of pkCols) {
						pks[pk.name] = row[pk.name]
					}
					tabsStore.openTab({
						type: 'row-detail',
						title: `${props.currentTable()} — ${Object.values(pks).join(', ')}`,
						connectionId: props.connectionId,
						schema: props.currentSchema(),
						table: props.currentTable(),
						database: props.database,
						primaryKeys: pks,
					})
				},
				disabled: t.columns.filter((c) => c.isPrimaryKey).length === 0
					|| gridStore.isRowNew(props.tabId, rowIndex),
			},
			{
				label: 'Duplicate Row',
				icon: () => <CopyPlus size={14} />,
				action: () => props.onDuplicateRow(rowIndex),
				disabled: ro,
			},
			{
				label: 'Delete Row',
				icon: () => <Trash2 size={14} />,
				action: () => {
					gridStore.selectFullRow(
						props.tabId,
						rowIndex,
						props.visibleColumns().length,
					)
					gridStore.deleteSelectedRows(props.tabId)
				},
				disabled: isDeleted || ro,
			},
		]

		const fkTarget = props.fkMap().get(column)
		if (fkTarget && value !== null && value !== undefined) {
			items.push('separator')
			items.push({ type: 'label', label: 'Foreign Key' })
			items.push({
				label: 'Peek referenced row',
				icon: () => <Link size={14} />,
				action: () => props.onFkClick(rowIndex, column),
			})
			items.push({
				label: `Open ${fkTarget.table} in Panel`,
				icon: () => <PanelRightOpen size={14} />,
				action: () => {
					const colIdx = props
						.visibleColumns()
						.findIndex((c) => c.name === column)
					if (colIdx >= 0) {
						gridStore.selectCell(props.tabId, rowIndex, colIdx)
					}
					gridStore.openFkPanel(props.tabId, fkTarget.schema, fkTarget.table, [
						{ column: fkTarget.column, operator: 'eq', value: String(value) },
					])
					props.onSetSidePanelOpen(true)
				},
			})
			items.push({
				label: `Open ${fkTarget.table} in Tab`,
				icon: () => <ExternalLink size={14} />,
				action: () => {
					tabsStore.openTab({
						type: 'data-grid',
						title: fkTarget.table,
						connectionId: props.connectionId,
						schema: fkTarget.schema,
						table: fkTarget.table,
						database: props.database,
					})
				},
			})
		}

		return items
	}

	const headerContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = headerContextMenu()
		if (!ctx) return []
		const { column } = ctx
		const t = tab()
		const pinned = t?.columnConfig[column]?.pinned
		const colDef = t?.columns.find((c: GridColumnDef) => c.name === column)
		const isNumeric = colDef ? isNumericType(colDef.dataType) : false
		const currentHeatmap = t?.heatmapColumns[column]
		const currentSort = t?.sort.find((s) => s.column === column)

		const items: ContextMenuEntry[] = [
			{ type: 'label', label: 'Sort' },
			{
				type: 'button-row',
				buttons: [
					{
						label: 'Asc',
						icon: () => <ArrowUp size={14} />,
						active: currentSort?.direction === 'asc',
						action: () => gridStore.toggleSort(props.tabId, column, false),
					},
					{
						label: 'Desc',
						icon: () => <ArrowDown size={14} />,
						active: currentSort?.direction === 'desc',
						action: () => sortDescending(column),
					},
				],
			},
			'separator',
			{ type: 'label', label: 'Column' },
			{
				label: 'Hide Column',
				icon: () => <EyeOff size={14} />,
				action: () => gridStore.setColumnVisibility(props.tabId, column, false),
			},
			{
				label: 'Filter by Column',
				icon: () => <FilterIcon size={14} />,
				action: () => {
					gridStore.setFilter(props.tabId, {
						column,
						operator: 'isNotNull',
						value: '',
					})
				},
			},
			'separator',
			{ type: 'label', label: 'Pin' },
			{
				type: 'button-row',
				buttons: [
					{
						label: 'Left',
						icon: () => <PinLeft size={14} />,
						active: pinned === 'left',
						action: () => gridStore.setColumnPinned(props.tabId, column, pinned === 'left' ? undefined : 'left'),
					},
					{
						label: 'Right',
						icon: () => <PinRight size={14} />,
						active: pinned === 'right',
						action: () => gridStore.setColumnPinned(props.tabId, column, pinned === 'right' ? undefined : 'right'),
					},
				],
			},
		]

		if (isNumeric) {
			items.push('separator')
			items.push({ type: 'label', label: 'Heatmap' })
			items.push({
				type: 'button-row',
				buttons: [
					{
						label: 'Sequential',
						icon: () => <Thermometer size={14} />,
						active: currentHeatmap === 'sequential',
						action: () => {
							if (currentHeatmap === 'sequential') {
								gridStore.removeHeatmap(props.tabId, column)
							} else {
								gridStore.setHeatmap(props.tabId, column, 'sequential')
							}
						},
					},
					{
						label: 'Diverging',
						icon: () => <Thermometer size={14} />,
						active: currentHeatmap === 'diverging',
						action: () => {
							if (currentHeatmap === 'diverging') {
								gridStore.removeHeatmap(props.tabId, column)
							} else {
								gridStore.setHeatmap(props.tabId, column, 'diverging')
							}
						},
					},
				],
			})
		}

		// Auto-join / Remove join / nested join for FK columns
		const fkTarget = props.fkMap().get(column)
		const alreadyJoined = t?.autoJoins.some((j) => j.fkColumn === column)
		const parentJoin = isJoinedColumn(column)
			? t?.autoJoins.find((j) => j.referencedTable === parseJoinedColumn(column).table)
			: undefined

		if (fkTarget || parentJoin) {
			items.push('separator')
			items.push({ type: 'label', label: 'Foreign Key' })

			// Show "Auto Join" or "Remove Join" for this column's FK
			if (fkTarget) {
				if (alreadyJoined) {
					items.push({
						label: `Remove Join ${fkTarget.table}`,
						icon: () => <Unlink size={14} />,
						action: () => gridStore.removeAutoJoin(props.tabId, column),
					})
				} else {
					items.push({
						label: `Auto Join ${fkTarget.table}`,
						icon: () => <LinkIcon size={14} />,
						action: () => gridStore.addAutoJoin(props.tabId, column),
					})
				}
			}

			// For joined columns: also show "Remove Join" for the parent join
			if (parentJoin && !alreadyJoined) {
				items.push({
					label: `Remove Join ${parentJoin.referencedTable}`,
					icon: () => <Unlink size={14} />,
					action: () => gridStore.removeAutoJoin(props.tabId, parentJoin.fkColumn),
				})
			}
		}

		return items
	}

	return (
		<>
			<Show when={cellContextMenu()}>
				{(_) => {
					const ctx = () => cellContextMenu()!
					return (
						<ContextMenu
							x={ctx().x}
							y={ctx().y}
							items={cellContextMenuItems()}
							onClose={closeContextMenus}
						/>
					)
				}}
			</Show>

			<Show when={headerContextMenu()}>
				{(_) => {
					const ctx = () => headerContextMenu()!
					return (
						<ContextMenu
							x={ctx().x}
							y={ctx().y}
							items={headerContextMenuItems()}
							onClose={closeContextMenus}
						/>
					)
				}}
			</Show>
		</>
	)
}
