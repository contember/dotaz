import { createMemo, createSignal, For, Show } from 'solid-js'
import type { GridColumnDef } from '../../../shared/types/grid'
import Dialog from '../common/Dialog'
import './PastePreviewDialog.css'

interface PastePreviewDialogProps {
	open: boolean
	parsedRows: string[][]
	delimiter: string
	columns: GridColumnDef[]
	startColumn: string
	startRow: number
	totalExistingRows: number
	onConfirm: (treatNullText: boolean) => void
	onClose: () => void
}

const MAX_PREVIEW_ROWS = 10

export default function PastePreviewDialog(props: PastePreviewDialogProps) {
	const [treatNullText, setTreatNullText] = createSignal(true)

	const delimiterLabel = createMemo(() => {
		switch (props.delimiter) {
			case '\t':
				return 'Tab'
			case ',':
				return 'Comma'
			case ';':
				return 'Semicolon'
			default:
				return props.delimiter
		}
	})

	const targetColumns = createMemo(() => {
		const colNames = props.columns.map((c) => c.name)
		const startIdx = colNames.indexOf(props.startColumn)
		if (startIdx < 0) return []
		const maxCols = props.parsedRows.reduce((max, r) => Math.max(max, r.length), 0)
		return colNames.slice(startIdx, startIdx + maxCols)
	})

	const newRowCount = createMemo(() => {
		const endRow = props.startRow + props.parsedRows.length
		return Math.max(0, endRow - props.totalExistingRows)
	})

	const previewRows = createMemo(() => props.parsedRows.slice(0, MAX_PREVIEW_ROWS))

	return (
		<Dialog open={props.open} title="Paste Preview" onClose={props.onClose}>
			<div class="paste-preview">
				<div class="paste-preview__info">
					<span>{props.parsedRows.length} row{props.parsedRows.length !== 1 ? 's' : ''}</span>
					<span class="paste-preview__sep">|</span>
					<span>{targetColumns().length} column{targetColumns().length !== 1 ? 's' : ''}</span>
					<span class="paste-preview__sep">|</span>
					<span>Delimiter: {delimiterLabel()}</span>
					<Show when={newRowCount() > 0}>
						<span class="paste-preview__sep">|</span>
						<span class="paste-preview__new-rows">{newRowCount()} new row{newRowCount() !== 1 ? 's' : ''} will be created</span>
					</Show>
				</div>

				<div class="paste-preview__section">
					<span class="paste-preview__label">Column mapping</span>
					<div class="paste-preview__mapping">
						<For each={targetColumns()}>
							{(col) => <span class="paste-preview__col">{col}</span>}
						</For>
					</div>
				</div>

				<div class="paste-preview__section">
					<span class="paste-preview__label">Sample data</span>
					<div class="paste-preview__table-wrap">
						<table class="paste-preview__table">
							<thead>
								<tr>
									<For each={targetColumns()}>
										{(col) => <th>{col}</th>}
									</For>
								</tr>
							</thead>
							<tbody>
								<For each={previewRows()}>
									{(row) => (
										<tr>
											<For each={targetColumns()}>
												{(_, colIdx) => (
													<td class={row[colIdx()] === '' ? 'paste-preview__null' : ''}>
														{row[colIdx()] === '' ? 'NULL' : (row[colIdx()] ?? '')}
													</td>
												)}
											</For>
										</tr>
									)}
								</For>
								<Show when={props.parsedRows.length > MAX_PREVIEW_ROWS}>
									<tr class="paste-preview__more">
										<td colSpan={targetColumns().length}>
											... {props.parsedRows.length - MAX_PREVIEW_ROWS} more row{props.parsedRows.length - MAX_PREVIEW_ROWS !== 1 ? 's' : ''}
										</td>
									</tr>
								</Show>
							</tbody>
						</table>
					</div>
				</div>

				<div class="paste-preview__section">
					<label class="paste-preview__checkbox-label">
						<input
							type="checkbox"
							checked={treatNullText()}
							onChange={(e) => setTreatNullText(e.currentTarget.checked)}
						/>
						Treat "NULL" text as NULL value
					</label>
				</div>

				<div class="paste-preview__actions">
					<button class="btn btn--ghost" onClick={props.onClose}>Cancel</button>
					<button
						class="btn btn--primary"
						onClick={() => props.onConfirm(treatNullText())}
					>
						Paste {props.parsedRows.length} row{props.parsedRows.length !== 1 ? 's' : ''}
					</button>
				</div>
			</div>
		</Dialog>
	)
}
