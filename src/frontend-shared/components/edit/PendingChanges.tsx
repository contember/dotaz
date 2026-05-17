import type { DatabaseDataType } from '@dotaz/shared/types/database'
import { isSqlDefault } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import Check from 'lucide-solid/icons/check'
import Code from 'lucide-solid/icons/code'
import Minus from 'lucide-solid/icons/minus'
import Pencil from 'lucide-solid/icons/pencil'
import Plus from 'lucide-solid/icons/plus'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import X from 'lucide-solid/icons/x'
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import { friendlyErrorMessage } from '../../lib/rpc-errors'
import { formatColumnValue } from '../../lib/value-format'
import { gridStore } from '../../stores/grid'
import Dialog from '../common/Dialog'
import './PendingChanges.css'

interface PendingChangesProps {
	open: boolean
	tabId: string
	connectionId: string
	database?: string
	onClose: () => void
	onApplied: () => void
}

interface ChangeItem {
	type: 'insert' | 'update' | 'delete'
	rowIndex: number
	description: string
}

function changeKey(item: { type: ChangeItem['type']; rowIndex: number }): string {
	return `${item.type}:${item.rowIndex}`
}

function formatValue(value: unknown, dataType?: DatabaseDataType): string {
	if (dataType !== undefined) return formatColumnValue(value, dataType)
	if (isSqlDefault(value)) return 'DEFAULT'
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function truncate(str: string, max: number): string {
	return str.length > max ? str.substring(0, max) + '...' : str
}

export default function PendingChanges(props: PendingChangesProps) {
	const [applying, setApplying] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [previewSql, setPreviewSql] = createSignal<string | null>(null)
	// Items the user has explicitly *un*selected — default is "all selected" so the
	// dialog behaves like the previous version unless the user opts into partial commit.
	const [deselected, setDeselected] = createSignal<ReadonlySet<string>>(new Set())

	const tab = () => gridStore.getTab(props.tabId)

	function buildChangeList(): ChangeItem[] {
		const t = tab()
		if (!t) return []

		const items: ChangeItem[] = []
		const pkColumns = t.columns.filter((c: GridColumnDef) => c.isPrimaryKey).map((c: GridColumnDef) => c.name)
		const colByName = new Map(t.columns.map((c: GridColumnDef) => [c.name, c] as const))
		const fmt = (col: string, value: unknown) => formatValue(value, colByName.get(col)?.dataType)

		// Collect updates: group cell edits by row
		const editsByRow = new Map<number, Array<{ column: string; oldValue: unknown; newValue: unknown }>>()
		for (const edit of Object.values(t.pendingChanges.cellEdits)) {
			if (t.pendingChanges.newRows.has(edit.rowIndex)) continue
			if (t.pendingChanges.deletedRows.has(edit.rowIndex)) continue
			let rowEdits = editsByRow.get(edit.rowIndex)
			if (!rowEdits) {
				rowEdits = []
				editsByRow.set(edit.rowIndex, rowEdits)
			}
			rowEdits.push({ column: edit.column, oldValue: edit.oldValue, newValue: edit.newValue })
		}

		for (const [rowIndex, edits] of editsByRow) {
			const row = t.rows[rowIndex]
			const pkDesc = pkColumns.map((pk: string) => `${pk}=${fmt(pk, row?.[pk])}`).join(', ')
			const editDescs = edits.map(
				(e) => `${e.column}: ${truncate(fmt(e.column, e.oldValue), 20)} \u2192 ${truncate(fmt(e.column, e.newValue), 20)}`,
			)
			items.push({
				type: 'update',
				rowIndex,
				description: pkDesc ? `[${pkDesc}] ${editDescs.join('; ')}` : editDescs.join('; '),
			})
		}

		// Collect inserts
		for (const rowIndex of t.pendingChanges.newRows) {
			const row = t.rows[rowIndex]
			if (!row) continue
			const nonNullCols = Object.entries(row)
				.filter(([, v]) => v !== null && v !== undefined)
				.map(([k, v]) => `${k}=${truncate(fmt(k, v), 15)}`)
			items.push({
				type: 'insert',
				rowIndex,
				description: nonNullCols.length > 0 ? `New row (${nonNullCols.slice(0, 3).join(', ')}${nonNullCols.length > 3 ? ', ...' : ''})` : 'New row',
			})
		}

		// Collect deletes
		for (const rowIndex of t.pendingChanges.deletedRows) {
			const row = t.rows[rowIndex]
			if (!row) continue
			const pkDesc = pkColumns.map((pk: string) => `${pk}=${fmt(pk, row[pk])}`).join(', ')
			items.push({
				type: 'delete',
				rowIndex,
				description: pkDesc ? `Row ${pkDesc}` : `Row #${rowIndex + 1}`,
			})
		}

		return items
	}

	function typeIcon(type: 'insert' | 'update' | 'delete'): JSX.Element {
		switch (type) {
			case 'insert':
				return <Plus size={12} />
			case 'update':
				return <Pencil size={12} />
			case 'delete':
				return <Minus size={12} />
		}
	}

	function typeLabel(type: 'insert' | 'update' | 'delete'): string {
		switch (type) {
			case 'insert':
				return 'INSERT'
			case 'update':
				return 'UPDATE'
			case 'delete':
				return 'DELETE'
		}
	}

	const items = createMemo(() => buildChangeList())
	const selectedKeys = createMemo(() => {
		const keys = new Set<string>()
		const off = deselected()
		for (const item of items()) {
			const k = changeKey(item)
			if (!off.has(k)) keys.add(k)
		}
		return keys
	})
	const allSelected = () => selectedKeys().size === items().length && items().length > 0
	const noneSelected = () => selectedKeys().size === 0
	const isPartial = () => !allSelected() && !noneSelected()

	function toggleItem(item: ChangeItem) {
		const k = changeKey(item)
		setDeselected((prev) => {
			const next = new Set(prev)
			if (next.has(k)) next.delete(k)
			else next.add(k)
			return next
		})
	}

	function toggleAll() {
		if (allSelected()) {
			setDeselected(new Set<string>(items().map(changeKey)))
		} else {
			setDeselected(new Set<string>())
		}
	}

	function handleRevertItem(item: ChangeItem) {
		switch (item.type) {
			case 'update':
				gridStore.revertRowUpdate(props.tabId, item.rowIndex)
				break
			case 'insert':
				gridStore.revertNewRow(props.tabId, item.rowIndex)
				break
			case 'delete':
				gridStore.revertDeletedRow(props.tabId, item.rowIndex)
				break
		}
	}

	function handleRevertAll() {
		gridStore.revertChanges(props.tabId)
		setError(null)
		setPreviewSql(null)
		props.onClose()
	}

	async function handleApply() {
		if (!gridStore.hasPendingChanges(props.tabId)) return
		if (noneSelected()) return

		setApplying(true)
		setError(null)
		try {
			const partial = isPartial()
			const selected = partial ? selectedKeys() : undefined
			await gridStore.applyChanges(props.tabId, props.database, selected)
			if (partial) {
				gridStore.clearAppliedChanges(props.tabId, selectedKeys())
				setDeselected(new Set<string>())
				setPreviewSql(null)
				// Keep dialog open if there are still pending changes; otherwise close
				if (!gridStore.hasPendingChanges(props.tabId)) {
					props.onApplied()
					props.onClose()
				} else {
					props.onApplied()
				}
			} else {
				gridStore.clearPendingChanges(props.tabId)
				setPreviewSql(null)
				props.onApplied()
				props.onClose()
			}
		} catch (err) {
			setError(friendlyErrorMessage(err))
		} finally {
			setApplying(false)
		}
	}

	function handlePreviewSql() {
		if (!gridStore.hasPendingChanges(props.tabId)) return
		if (noneSelected()) return
		try {
			const sql = gridStore.generateSqlPreview(props.tabId, isPartial() ? selectedKeys() : undefined)
			setPreviewSql(sql)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	return (
		<Dialog open={props.open} title="Pending Changes" onClose={props.onClose} class="pending-changes-dialog">
			<div class="pending-changes">
				<Show when={error()}>
					<div class="pending-changes__error">
						{error()}
					</div>
				</Show>

				<div class="pending-changes__list">
					<Show when={items().length > 1}>
						<label class="pending-changes__select-all">
							<input
								type="checkbox"
								checked={allSelected()}
								ref={(el) => createEffect(() => {
									el.indeterminate = isPartial()
								})}
								onChange={toggleAll}
								disabled={applying()}
							/>
							<span>{allSelected() ? 'Deselect all' : 'Select all'}</span>
						</label>
					</Show>
					<For each={items()}>
						{(item) => {
							const key = changeKey(item)
							const checked = () => selectedKeys().has(key)
							return (
								<label
									class={`pending-changes__item pending-changes__item--${item.type}`}
									classList={{ 'pending-changes__item--unchecked': !checked() }}
								>
									<input
										type="checkbox"
										class="pending-changes__item-check"
										checked={checked()}
										onChange={() => toggleItem(item)}
										disabled={applying()}
									/>
									<span class={`pending-changes__item-icon pending-changes__item-icon--${item.type}`}>
										{typeIcon(item.type)}
									</span>
									<span class="pending-changes__item-type">
										{typeLabel(item.type)}
									</span>
									<span class="pending-changes__item-desc" title={item.description}>
										{item.description}
									</span>
									<button
										class="pending-changes__item-revert"
										onClick={(e) => {
											e.preventDefault()
											handleRevertItem(item)
										}}
										disabled={applying()}
										title="Revert this change"
									>
										<X size={14} />
									</button>
								</label>
							)
						}}
					</For>
				</div>

				<Show when={previewSql()}>
					<div class="pending-changes__preview">
						<div class="pending-changes__preview-header">
							<span>SQL Preview</span>
							<button
								class="pending-changes__preview-close"
								onClick={() => setPreviewSql(null)}
								title="Close preview"
							>
								<X size={14} />
							</button>
						</div>
						<pre class="pending-changes__preview-sql">{previewSql()}</pre>
					</div>
				</Show>

				<div class="pending-changes__footer">
					<button
						class="pending-changes__btn pending-changes__btn--revert"
						onClick={handleRevertAll}
						disabled={applying()}
						title="Revert all changes"
					>
						<RotateCcw size={12} /> Revert All
					</button>
					<div class="pending-changes__footer-right">
						<button
							class="pending-changes__btn pending-changes__btn--preview"
							onClick={handlePreviewSql}
							disabled={applying() || noneSelected()}
							title="Preview SQL"
						>
							<Code size={12} /> Preview SQL
						</button>
						<button
							class="pending-changes__btn pending-changes__btn--apply"
							onClick={handleApply}
							disabled={applying() || noneSelected()}
							title={isPartial() ? 'Save selected changes' : 'Save all changes'}
						>
							<Check size={12} /> {applying()
								? 'Saving...'
								: isPartial()
								? `Save Selected (${selectedKeys().size})`
								: 'Save'}
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	)
}
