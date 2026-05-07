import { cellValueToDbValue, parseClipboardText } from '@dotaz/shared/clipboard-paste'
import { type Accessor, createSignal } from 'solid-js'
import { gridStore } from '../../stores/grid'

const COPY_FLASH_DURATION = 400
const PASTE_PREVIEW_THRESHOLD = 50

interface UseDataGridClipboardParams {
	tabId: string
	isReadOnly: Accessor<boolean>
	getFocusedCellInfo: () => { row: number; column: string } | null
	onOpenPastePreview: (rows: string[][], delimiter: string) => void
}

/**
 * Paste-side clipboard logic for DataGrid: read clipboard, parse, optionally show preview,
 * then paste into the grid. Copy is handled inside <GridView> directly.
 */
export function useDataGridClipboard(params: UseDataGridClipboardParams) {
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null)

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
		handlePaste,
		handlePastePreviewConfirm,
	}
}
