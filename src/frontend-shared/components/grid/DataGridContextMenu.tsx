import { isNumericType } from '@dotaz/shared/column-types'
import { isJoinedColumn, parseJoinedColumn } from '@dotaz/shared/sql'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import ArrowDown from 'lucide-solid/icons/arrow-down'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import Slash from 'lucide-solid/icons/ban'
import CalendarClock from 'lucide-solid/icons/calendar-clock'
import Calendar from 'lucide-solid/icons/calendar-days'
import ClipboardCopy from 'lucide-solid/icons/clipboard-copy'
import ClipboardPaste from 'lucide-solid/icons/clipboard-paste'
import Clock from 'lucide-solid/icons/clock'
import Copy from 'lucide-solid/icons/copy'
import CopyPlus from 'lucide-solid/icons/copy-plus'
import ExternalLink from 'lucide-solid/icons/external-link'
import EyeOff from 'lucide-solid/icons/eye-off'
import FilterIcon from 'lucide-solid/icons/funnel'
import FilterXIcon from 'lucide-solid/icons/funnel-x'
import KeyRound from 'lucide-solid/icons/key-round'
import Link from 'lucide-solid/icons/link'
import LinkIcon from 'lucide-solid/icons/link-2'
import PinLeft from 'lucide-solid/icons/panel-left-close'
import PanelRight from 'lucide-solid/icons/panel-right'
import PinRight from 'lucide-solid/icons/panel-right-close'
import PanelRightOpen from 'lucide-solid/icons/panel-right-open'
import Pencil from 'lucide-solid/icons/pencil'
import Rows3 from 'lucide-solid/icons/rows-3'
import Sparkles from 'lucide-solid/icons/sparkles'
import Thermometer from 'lucide-solid/icons/thermometer'
import Trash2 from 'lucide-solid/icons/trash-2'
import Unlink from 'lucide-solid/icons/unlink'
import { formatCellForClipboard } from '../../lib/grid-clipboard'
import {
	generateCurrentDate,
	generateCurrentTime,
	generateCurrentTimestamp,
	generateUuidV4,
	generateUuidV7,
	getValueGeneratorKinds,
} from '../../lib/value-generators'
import type { FkTarget } from '../../stores/grid'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import type { ContextMenuEntry } from '../common/ContextMenu'

function createValueGeneratorItems(
	column: GridColumnDef,
	onGenerate: (value: string) => void,
): ContextMenuEntry[] {
	const items: ContextMenuEntry[] = []

	for (const kind of getValueGeneratorKinds(column.dataType)) {
		switch (kind) {
			case 'uuid-v4':
				items.push({
					label: 'UUID v4',
					icon: () => <KeyRound size={14} />,
					action: () => onGenerate(generateUuidV4()),
				})
				break
			case 'uuid-v7':
				items.push({
					label: 'UUID v7',
					icon: () => <KeyRound size={14} />,
					action: () => onGenerate(generateUuidV7()),
				})
				break
			case 'current-date':
				items.push({
					label: 'Current date',
					icon: () => <Calendar size={14} />,
					action: () => onGenerate(generateCurrentDate()),
				})
				break
			case 'current-time':
				items.push({
					label: 'Current time',
					icon: () => <Clock size={14} />,
					action: () => onGenerate(generateCurrentTime()),
				})
				break
			case 'current-timestamp':
				items.push({
					label: 'Current timestamp',
					icon: () => <CalendarClock size={14} />,
					action: () => onGenerate(generateCurrentTimestamp()),
				})
				break
		}
	}

	return items
}

export interface DataGridContextMenuDeps {
	tabId: string
	connectionId: string
	currentSchema: () => string
	currentTable: () => string
	database?: string
	fkMap: () => Map<string, FkTarget>
	visibleColumns: () => GridColumnDef[]
	isReadOnly: () => boolean
	isColumnEditable: (column: string) => boolean
	onPaste: () => void
	onAdvancedCopy: () => void
	onDuplicateRow: (rowIndex: number) => void
	onFkClick: (rowIndex: number, column: string) => void
	onSetSidePanelOpen: (open: boolean) => void
}

/**
 * Builds the context-menu item providers for a table-view DataGrid. Returns
 * functions that GridView calls when the user right-clicks a cell or header.
 */
export function useDataGridContextMenu(deps: DataGridContextMenuDeps) {
	function sortDescending(column: string) {
		const t = gridStore.getTab(deps.tabId)
		const existing = t?.sort.find((s) => s.column === column)
		if (!existing || existing.direction === 'desc') {
			gridStore.toggleSort(deps.tabId, column, false)
		}
		gridStore.toggleSort(deps.tabId, column, false)
	}

	function getCellContextMenu(ctx: { rowIndex: number; column: string }): ContextMenuEntry[] | null {
		const t = gridStore.getTab(deps.tabId)
		if (!t) return null
		const { rowIndex, column } = ctx
		const row = t.rows[rowIndex]
		if (!row) return null
		const value = row[column]
		const columnDef = t.columns.find((candidate) => candidate.name === column)
		const isDeleted = gridStore.isRowDeleted(deps.tabId, rowIndex)
		const ro = deps.isReadOnly()
		const cellReadOnly = !deps.isColumnEditable(column)
		const currentSort = t.sort.find((s) => s.column === column)
		const generatorItems = columnDef
			? createValueGeneratorItems(
				columnDef,
				(generatedValue) => gridStore.setCellValue(deps.tabId, rowIndex, column, generatedValue),
			)
			: []
		const generatorMenu: ContextMenuEntry[] = generatorItems.length > 0
			? [{
				type: 'submenu',
				label: 'Generate value',
				icon: () => <Sparkles size={14} />,
				disabled: isDeleted || cellReadOnly,
				items: generatorItems,
			}]
			: []

		const items: ContextMenuEntry[] = [
			{ type: 'label', label: 'Clipboard' },
			{
				label: 'Copy Value',
				icon: () => <Copy size={14} />,
				action: async () => {
					await navigator.clipboard.writeText(formatCellForClipboard(value))
				},
			},
			{
				label: 'Copy Row',
				icon: () => <Rows3 size={14} />,
				action: async () => {
					const cols = deps.visibleColumns()
					const header = cols.map((c) => c.name).join('\t')
					const rowText = cols.map((c) => formatCellForClipboard(row[c.name])).join('\t')
					await navigator.clipboard.writeText(`${header}\n${rowText}`)
				},
			},
			{
				label: 'Advanced Copy...',
				icon: () => <ClipboardCopy size={14} />,
				action: () => deps.onAdvancedCopy(),
			},
			{
				label: 'Paste',
				icon: () => <ClipboardPaste size={14} />,
				action: () => deps.onPaste(),
				disabled: isDeleted || ro,
			},
			'separator',
			{ type: 'label', label: 'Edit' },
			{
				label: 'Edit Cell',
				icon: () => <Pencil size={14} />,
				action: () => gridStore.startEditing(deps.tabId, rowIndex, column),
				disabled: isDeleted || cellReadOnly,
			},
			{
				label: 'Set NULL',
				icon: () => <Slash size={14} />,
				action: () => gridStore.setCellValue(deps.tabId, rowIndex, column, null),
				disabled: isDeleted || cellReadOnly,
			},
			...generatorMenu,
			'separator',
			{ type: 'label', label: 'Sort' },
			{
				type: 'button-row',
				buttons: [
					{
						label: 'Asc',
						icon: () => <ArrowUp size={14} />,
						active: currentSort?.direction === 'asc',
						action: () => gridStore.toggleSort(deps.tabId, column, false),
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
						action: () => gridStore.addValueFilter(deps.tabId, column, value, false),
					},
					{
						label: value === null ? 'Not NULL' : 'Exclude',
						icon: () => <FilterXIcon size={14} />,
						action: () => gridStore.addValueFilter(deps.tabId, column, value, true),
					},
				],
			},
			'separator',
			{ type: 'label', label: 'Row' },
			{
				label: 'Row Detail',
				icon: () => <PanelRight size={14} />,
				action: () => {
					gridStore.selectFullRow(deps.tabId, rowIndex, deps.visibleColumns().length)
					gridStore.closeFkPanel(deps.tabId)
					deps.onSetSidePanelOpen(true)
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
						title: `${deps.currentTable()} — ${Object.values(pks).join(', ')}`,
						connectionId: deps.connectionId,
						schema: deps.currentSchema(),
						table: deps.currentTable(),
						database: deps.database,
						primaryKeys: pks,
					})
				},
				disabled: t.columns.filter((c) => c.isPrimaryKey).length === 0
					|| gridStore.isRowNew(deps.tabId, rowIndex),
			},
			{
				label: 'Duplicate Row',
				icon: () => <CopyPlus size={14} />,
				action: () => deps.onDuplicateRow(rowIndex),
				disabled: ro,
			},
			{
				label: 'Delete Row',
				icon: () => <Trash2 size={14} />,
				action: () => {
					gridStore.selectFullRow(deps.tabId, rowIndex, deps.visibleColumns().length)
					gridStore.deleteSelectedRows(deps.tabId)
				},
				disabled: isDeleted || ro,
			},
		]

		const fkTarget = deps.fkMap().get(column)
		if (fkTarget && value !== null && value !== undefined) {
			items.push('separator')
			items.push({ type: 'label', label: 'Foreign Key' })
			items.push({
				label: 'Peek referenced row',
				icon: () => <Link size={14} />,
				action: () => deps.onFkClick(rowIndex, column),
			})
			items.push({
				label: `Open ${fkTarget.table} in Panel`,
				icon: () => <PanelRightOpen size={14} />,
				action: () => {
					const colIdx = deps.visibleColumns().findIndex((c) => c.name === column)
					if (colIdx >= 0) {
						gridStore.selectCell(deps.tabId, rowIndex, colIdx)
					}
					gridStore.openFkPanel(deps.tabId, fkTarget.schema, fkTarget.table, [
						{ column: fkTarget.column, operator: 'eq', value: String(value) },
					])
					deps.onSetSidePanelOpen(true)
				},
			})
			items.push({
				label: `Open ${fkTarget.table} in Tab`,
				icon: () => <ExternalLink size={14} />,
				action: () => {
					tabsStore.openTab({
						type: 'data-grid',
						title: fkTarget.table,
						connectionId: deps.connectionId,
						schema: fkTarget.schema,
						table: fkTarget.table,
						database: deps.database,
					})
				},
			})
		}

		return items
	}

	function getHeaderContextMenu(ctx: { column: string }): ContextMenuEntry[] | null {
		const { column } = ctx
		const t = gridStore.getTab(deps.tabId)
		if (!t) return null
		const pinned = t.columnConfig[column]?.pinned
		const colDef = t.columns.find((c: GridColumnDef) => c.name === column)
		const isNumeric = colDef ? isNumericType(colDef.dataType) : false
		const currentHeatmap = t.heatmapColumns[column]
		const currentSort = t.sort.find((s) => s.column === column)

		const items: ContextMenuEntry[] = [
			{ type: 'label', label: 'Sort' },
			{
				type: 'button-row',
				buttons: [
					{
						label: 'Asc',
						icon: () => <ArrowUp size={14} />,
						active: currentSort?.direction === 'asc',
						action: () => gridStore.toggleSort(deps.tabId, column, false),
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
				action: () => gridStore.setColumnVisibility(deps.tabId, column, false),
			},
			{
				label: 'Filter by Column',
				icon: () => <FilterIcon size={14} />,
				action: () => {
					gridStore.setFilter(deps.tabId, { column, operator: 'isNotNull', value: '' })
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
						action: () =>
							gridStore.setColumnPinned(
								deps.tabId,
								column,
								pinned === 'left' ? undefined : 'left',
							),
					},
					{
						label: 'Right',
						icon: () => <PinRight size={14} />,
						active: pinned === 'right',
						action: () =>
							gridStore.setColumnPinned(
								deps.tabId,
								column,
								pinned === 'right' ? undefined : 'right',
							),
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
								gridStore.removeHeatmap(deps.tabId, column)
							} else {
								gridStore.setHeatmap(deps.tabId, column, 'sequential')
							}
						},
					},
					{
						label: 'Diverging',
						icon: () => <Thermometer size={14} />,
						active: currentHeatmap === 'diverging',
						action: () => {
							if (currentHeatmap === 'diverging') {
								gridStore.removeHeatmap(deps.tabId, column)
							} else {
								gridStore.setHeatmap(deps.tabId, column, 'diverging')
							}
						},
					},
				],
			})
		}

		const fkTarget = deps.fkMap().get(column)
		const alreadyJoined = t.autoJoins.some((j) => j.fkColumn === column)
		const parentJoin = isJoinedColumn(column)
			? t.autoJoins.find((j) => j.referencedTable === parseJoinedColumn(column).table)
			: undefined

		if (fkTarget || parentJoin) {
			items.push('separator')
			items.push({ type: 'label', label: 'Foreign Key' })

			if (fkTarget) {
				if (alreadyJoined) {
					items.push({
						label: `Remove Join ${fkTarget.table}`,
						icon: () => <Unlink size={14} />,
						action: () => gridStore.removeAutoJoin(deps.tabId, column),
					})
				} else {
					items.push({
						label: `Auto Join ${fkTarget.table}`,
						icon: () => <LinkIcon size={14} />,
						action: () => gridStore.addAutoJoin(deps.tabId, column),
					})
				}
			}

			if (parentJoin && !alreadyJoined) {
				items.push({
					label: `Remove Join ${parentJoin.referencedTable}`,
					icon: () => <Unlink size={14} />,
					action: () => gridStore.removeAutoJoin(deps.tabId, parentJoin.fkColumn),
				})
			}
		}

		return items
	}

	return { getCellContextMenu, getHeaderContextMenu }
}
