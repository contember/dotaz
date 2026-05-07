import type { GridColumnDef } from '@dotaz/shared/types/grid'
import Copy from 'lucide-solid/icons/copy'
import Rows3 from 'lucide-solid/icons/rows-3'
import { createContext, createSignal, type JSX, Show, useContext } from 'solid-js'
import { buildClipboardTsv, formatCellForClipboard } from '../../lib/grid-clipboard'
import { applyExtendFocus, applyMoveFocus, applySelectAll, applySelectCell, type CellSelection } from '../../lib/grid-selection'
import { isEditableTarget } from '../../lib/keyboard'
import type { ContextMenuEntry } from '../common/ContextMenu'
import ContextMenu from '../common/ContextMenu'
import type { GridViewEditing } from './GridView'

/**
 * Focusable wrapper that owns keyboard navigation, copy/paste shortcuts,
 * cell/header context-menu state, and the copy toast for any grid body.
 *
 * Used by `<GridView>` (standard table view) and by `<DataGrid>` to wrap
 * `<TransposedGrid>` so transposed mode keeps the same keyboard and context
 * menu behavior.
 */

interface GridShellApi {
	/** Opens the header context menu — called from `<GridHeader>` inside the body. */
	openHeaderContextMenu: (e: MouseEvent, column: string) => void
}

const GridShellContext = createContext<GridShellApi | null>(null)

/**
 * Hook used by grid bodies (e.g. `<GridView>`) to wire `<GridHeader>`'s
 * context menu into the surrounding `<GridShell>`. Returns `null` when no
 * shell is present.
 */
export function useGridShell(): GridShellApi | null {
	return useContext(GridShellContext)
}

export interface GridShellProps {
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]

	selection: CellSelection
	onSelectionChange: (sel: CellSelection) => void

	editing?: GridViewEditing

	getCellContextMenu?: (ctx: { rowIndex: number; column: string }) => ContextMenuEntry[] | null
	getHeaderContextMenu?: (ctx: { column: string }) => ContextMenuEntry[] | null

	onActivateSelection?: () => void
	onSaveShortcut?: () => void
	onAdvancedCopyShortcut?: () => void

	class?: string
	children: JSX.Element
}

export default function GridShell(props: GridShellProps) {
	let gridRef: HTMLDivElement | undefined

	const [cellMenu, setCellMenu] = createSignal<
		{ x: number; y: number; rowIndex: number; column: string } | null
	>(null)
	const [headerMenu, setHeaderMenu] = createSignal<
		{ x: number; y: number; column: string } | null
	>(null)
	const [copyToast, setCopyToast] = createSignal<string | null>(null)

	const totalRows = () => props.rows.length
	const totalCols = () => props.columns.length

	function commit(sel: CellSelection) {
		props.onSelectionChange(sel)
	}

	function commitOrSkip(sel: CellSelection | null) {
		if (sel) commit(sel)
	}

	function getFocusedColumn(): string | null {
		const f = props.selection.focusedCell
		if (!f) return null
		return props.columns[f.col]?.name ?? null
	}

	async function handleCopy() {
		const result = buildClipboardTsv(props.rows, props.columns, props.selection)
		if (!result) return
		try {
			await navigator.clipboard.writeText(result.text)
			const msg = result.rowCount === 0
				? 'Copied cell'
				: `Copied ${result.rowCount} row${result.rowCount > 1 ? 's' : ''}`
			setCopyToast(msg)
			setTimeout(() => setCopyToast(null), 400)
		} catch {
			// clipboard API may fail
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (isEditableTarget(e)) return

		const sel = props.selection
		const rows = totalRows()
		const cols = totalCols()
		const ed = props.editing

		// Editing-only keys
		if (e.key === 'F2') {
			if (!ed || !sel.focusedCell) return
			const colName = getFocusedColumn()
			if (!colName) return
			if (ed.isEditable && !ed.isEditable(colName)) return
			if (ed.isRowDeleted?.(sel.focusedCell.row)) return
			e.preventDefault()
			e.stopPropagation()
			ed.onStart(sel.focusedCell.row, colName)
			return
		}
		if (e.key === 'Delete') {
			if (!ed?.onDeleteSelected) return
			e.preventDefault()
			e.stopPropagation()
			ed.onDeleteSelected()
			return
		}
		if (e.key === 'Escape') {
			if (ed?.editingCell) {
				e.preventDefault()
				ed.onCancel()
			}
			return
		}
		if (ed?.editingCell) {
			// Inline editor owns most keys while open
			return
		}

		// Clipboard
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c' && props.onAdvancedCopyShortcut) {
			e.preventDefault()
			props.onAdvancedCopyShortcut()
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
			e.preventDefault()
			handleCopy()
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
			if (ed?.onPaste) {
				e.preventDefault()
				ed.onPaste()
			}
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
			e.preventDefault()
			commitOrSkip(applySelectAll(rows, cols))
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && props.onSaveShortcut) {
			e.preventDefault()
			e.stopPropagation()
			props.onSaveShortcut()
			return
		}

		// Navigation
		if (e.key === 'ArrowUp') {
			e.preventDefault()
			commit(e.shiftKey ? applyExtendFocus(sel, -1, 0, rows, cols) : applyMoveFocus(sel, -1, 0, rows, cols))
			return
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			commit(e.shiftKey ? applyExtendFocus(sel, 1, 0, rows, cols) : applyMoveFocus(sel, 1, 0, rows, cols))
			return
		}
		if (e.key === 'ArrowLeft') {
			e.preventDefault()
			commit(e.shiftKey ? applyExtendFocus(sel, 0, -1, rows, cols) : applyMoveFocus(sel, 0, -1, rows, cols))
			return
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault()
			commit(e.shiftKey ? applyExtendFocus(sel, 0, 1, rows, cols) : applyMoveFocus(sel, 0, 1, rows, cols))
			return
		}
		if (e.key === 'Tab') {
			e.preventDefault()
			commit(applyMoveFocus(sel, 0, e.shiftKey ? -1 : 1, rows, cols))
			return
		}
		if (e.key === 'Home') {
			e.preventDefault()
			if (e.ctrlKey || e.metaKey) {
				commit(applySelectCell(0, 0))
			} else {
				commit(applySelectCell(sel.focusedCell?.row ?? 0, 0))
			}
			return
		}
		if (e.key === 'End') {
			e.preventDefault()
			if (e.ctrlKey || e.metaKey) {
				commit(applySelectCell(rows - 1, cols - 1))
			} else {
				commit(applySelectCell(sel.focusedCell?.row ?? 0, cols - 1))
			}
			return
		}
		if (e.key === 'Enter') {
			if (sel.ranges.length > 0 && props.onActivateSelection) {
				e.preventDefault()
				props.onActivateSelection()
			}
			return
		}
	}

	function closeMenus() {
		setCellMenu(null)
		setHeaderMenu(null)
	}

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
		setHeaderMenu(null)

		// Move selection to the right-clicked cell if it's outside the current selection.
		const colIdx = props.columns.findIndex((c) => c.name === columnName)
		if (colIdx >= 0) {
			const inRange = props.selection.ranges.some((r) => rowIndex >= r.minRow && rowIndex <= r.maxRow && colIdx >= r.minCol && colIdx <= r.maxCol)
			if (!inRange) commit(applySelectCell(rowIndex, colIdx))
		}

		setCellMenu({ x: e.clientX, y: e.clientY, rowIndex, column: columnName })
	}

	const api: GridShellApi = {
		openHeaderContextMenu(e, column) {
			e.preventDefault()
			setCellMenu(null)
			setHeaderMenu({ x: e.clientX, y: e.clientY, column })
		},
	}

	const cellMenuItems = (): ContextMenuEntry[] => {
		const ctx = cellMenu()
		if (!ctx) return []
		const items = props.getCellContextMenu?.(ctx) ?? defaultCellMenu(ctx)
		return items ?? []
	}

	const headerMenuItems = (): ContextMenuEntry[] => {
		const ctx = headerMenu()
		if (!ctx) return []
		return props.getHeaderContextMenu?.(ctx) ?? []
	}

	function defaultCellMenu(ctx: { rowIndex: number; column: string }): ContextMenuEntry[] {
		const row = props.rows[ctx.rowIndex]
		const value = row?.[ctx.column]
		return [
			{
				label: 'Copy Value',
				icon: () => <Copy size={14} />,
				action: async () => {
					try {
						await navigator.clipboard.writeText(formatCellForClipboard(value))
					} catch {
						// ignore
					}
				},
			},
			{
				label: 'Copy Row',
				icon: () => <Rows3 size={14} />,
				action: async () => {
					if (!row) return
					const header = props.columns.map((c) => c.name).join('\t')
					const rowText = props.columns.map((c) => formatCellForClipboard(row[c.name])).join('\t')
					try {
						await navigator.clipboard.writeText(`${header}\n${rowText}`)
					} catch {
						// ignore
					}
				},
			},
		]
	}

	return (
		<GridShellContext.Provider value={api}>
			<div
				ref={gridRef}
				class={`grid-view${props.class ? ` ${props.class}` : ''}`}
				tabIndex={0}
				onKeyDown={handleKeyDown}
				onContextMenu={handleGridContextMenu}
			>
				{props.children}

				<Show when={cellMenu()}>
					{(_) => {
						const ctx = () => cellMenu()!
						return <ContextMenu x={ctx().x} y={ctx().y} items={cellMenuItems()} onClose={closeMenus} />
					}}
				</Show>

				<Show when={headerMenu()}>
					{(_) => {
						const ctx = () => headerMenu()!
						return <ContextMenu x={ctx().x} y={ctx().y} items={headerMenuItems()} onClose={closeMenus} />
					}}
				</Show>

				<Show when={copyToast()}>
					<div class="grid-view__copy-toast">{copyToast()}</div>
				</Show>
			</div>
		</GridShellContext.Provider>
	)
}
