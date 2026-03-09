import { type Accessor, createSignal } from 'solid-js'
import { cellValueToDbValue, parseClipboardText } from '@dotaz/shared/clipboard-paste'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { gridStore } from '../../stores/grid'

const COPY_FLASH_DURATION = 400
const PASTE_PREVIEW_THRESHOLD = 50

interface UseDataGridClipboardParams {
	tabId: string
	visibleColumns: Accessor<GridColumnDef[]>
	isReadOnly: Accessor<boolean>
	getFocusedCellInfo: () => { row: number; column: string } | null
	onOpenPastePreview: (rows: string[][], delimiter: string) => void
}

export function useDataGridClipboard(params: UseDataGridClipboardParams) {
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null)

	async function handleCopy() {
		const result = gridStore.buildClipboardTsv(params.tabId, params.visibleColumns())
		if (!result) return

		try {
			await navigator.clipboard.writeText(result.text)
			const msg = result.rowCount === 0
				? 'Copied cell'
				: `Copied ${result.rowCount} row${result.rowCount > 1 ? 's' : ''}`
			setCopyFeedback(msg)
			setTimeout(() => setCopyFeedback(null), COPY_FLASH_DURATION)
		} catch {
			// Clipboard API may fail in some contexts
		}
	}

	async function handlePaste() {
		if (params.isReadOnly()) return
		const focused = params.getFocusedCellInfo()
		if (!focused) return

		let text: string
		try {
			text = await navigator.clipboard.readText()
		} catch {
			return
		}
		if (!text.trim()) return

		const parsed = parseClipboardText(text)
		if (parsed.rows.length === 0) return

		if (parsed.rows.length > PASTE_PREVIEW_THRESHOLD) {
			params.onOpenPastePreview(parsed.rows, parsed.delimiter)
		} else {
			executePaste(parsed.rows, true)
		}
	}

	function executePaste(rows: string[][], treatNullText: boolean) {
		const focused = params.getFocusedCellInfo()
		if (!focused) return

		const data = rows.map((row) => row.map((cell) => cellValueToDbValue(cell, treatNullText)))
		gridStore.pasteCells(params.tabId, focused.row, focused.column, data)

		const msg = `Pasted ${rows.length} row${rows.length !== 1 ? 's' : ''}`
		setCopyFeedback(msg)
		setTimeout(() => setCopyFeedback(null), COPY_FLASH_DURATION)
	}

	function handlePastePreviewConfirm(treatNullText: boolean, modalRows: string[][]) {
		executePaste(modalRows, treatNullText)
	}

	return {
		copyFeedback,
		handleCopy,
		handlePaste,
		handlePastePreviewConfirm,
	}
}
