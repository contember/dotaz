import type { Accessor } from 'solid-js'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { createKeyHandler } from '../../lib/keyboard'
import { gridStore } from '../../stores/grid'
import type { DataGridSidePanelHandle } from './DataGridSidePanel'

interface UseDataGridKeyboardParams {
	tabId: string
	visibleColumns: Accessor<GridColumnDef[]>
	sidePanelHandle: Accessor<DataGridSidePanelHandle | undefined>
	onCopy: () => void
	onPaste: () => void
	onOpenAdvancedCopy: () => void
	onOpenSaveView: () => void
	startEditingFocused: () => void
	handleAddNewRow: () => void
	handleDeleteSelected: () => void
	handleCellCancel: () => void
}

export function useDataGridKeyboard(params: UseDataGridKeyboardParams) {
	const tab = () => gridStore.getTab(params.tabId)

	const handleKeyDown = createKeyHandler([
		{
			key: 'c',
			ctrl: true,
			shift: true,
			handler(e) {
				e.preventDefault()
				params.onOpenAdvancedCopy()
			},
		},
		{
			key: 'c',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				params.onCopy()
			},
		},
		{
			key: 'v',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				params.onPaste()
			},
		},
		{
			key: 'a',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.selectAll(
						params.tabId,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowUp',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						-1,
						0,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowDown',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						1,
						0,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowLeft',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						0,
						-1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowRight',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						0,
						1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowUp',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						params.tabId,
						-1,
						0,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowDown',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						params.tabId,
						1,
						0,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowLeft',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						params.tabId,
						0,
						-1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowRight',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						params.tabId,
						0,
						1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'Home',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					const focused = t.selection.focusedCell
					gridStore.selectCell(params.tabId, focused?.row ?? 0, 0)
				}
			},
		},
		{
			key: 'End',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					const focused = t.selection.focusedCell
					gridStore.selectCell(
						params.tabId,
						focused?.row ?? 0,
						params.visibleColumns().length - 1,
					)
				}
			},
		},
		{
			key: 'Home',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				gridStore.selectCell(params.tabId, 0, 0)
			},
		},
		{
			key: 'End',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.selectCell(
						params.tabId,
						t.rows.length - 1,
						params.visibleColumns().length - 1,
					)
				}
			},
		},
		{
			key: 'Tab',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						0,
						1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'Tab',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						params.tabId,
						0,
						-1,
						t.rows.length,
						params.visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'F2',
			handler(e) {
				e.preventDefault()
				e.stopPropagation()
				params.startEditingFocused()
			},
		},
		{
			key: 'Insert',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				params.handleAddNewRow()
			},
		},
		{
			key: 'Delete',
			handler(e) {
				e.preventDefault()
				e.stopPropagation()
				params.handleDeleteSelected()
			},
		},
		{
			key: 'Enter',
			handler(e) {
				const t = tab()
				if (t?.editingCell) return
				if (t && t.selection.ranges.length > 0) {
					e.preventDefault()
					params.sidePanelHandle()?.openForSelection()
				}
			},
		},
		{
			key: 's',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				e.stopPropagation()
				params.onOpenSaveView()
			},
		},
		{
			key: 'Escape',
			handler(e) {
				const t = tab()
				if (t?.editingCell) {
					e.preventDefault()
					params.handleCellCancel()
				}
			},
		},
	])

	return { handleKeyDown }
}
