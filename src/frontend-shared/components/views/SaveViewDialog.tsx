import { createEffect, createSignal, Show } from 'solid-js'
import type { SavedViewConfig } from '@dotaz/shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { gridStore } from '../../stores/grid'
import Dialog from '../common/Dialog'
import './SaveViewDialog.css'

interface SaveViewDialogProps {
	open: boolean
	tabId: string
	connectionId: string
	schema: string
	table: string
	initialName?: string
	forceNew?: boolean
	onClose: () => void
	onSaved: (viewId: string, viewName: string, config: SavedViewConfig) => void
}

export default function SaveViewDialog(props: SaveViewDialogProps) {
	const [name, setName] = createSignal('')
	const [updateExisting, setUpdateExisting] = createSignal(false)
	const [saving, setSaving] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	const tab = () => gridStore.getTab(props.tabId)

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			const t = tab()
			if (!props.forceNew && t?.activeViewId && t?.activeViewName) {
				setName(t.activeViewName)
				setUpdateExisting(true)
			} else {
				setName(props.initialName ?? '')
				setUpdateExisting(false)
			}
			setError(null)
			setSaving(false)
		}
	})

	function configSummary(): { filters: number; sortRules: number; hiddenColumns: number; colorRules: number } {
		const t = tab()
		if (!t) return { filters: 0, sortRules: 0, hiddenColumns: 0, colorRules: 0 }
		const hiddenCount = t.columns.filter(
			(col) => t.columnConfig[col.name]?.visible === false,
		).length
		return {
			filters: t.filters.length,
			sortRules: t.sort.length,
			hiddenColumns: hiddenCount,
			colorRules: t.rowColorRules.length,
		}
	}

	const showUpdateCheckbox = () => !props.forceNew && !!tab()?.activeViewId

	async function handleSave() {
		const trimmed = name().trim()
		if (!trimmed) {
			setError('View name is required')
			return
		}

		setSaving(true)
		setError(null)

		try {
			const config: SavedViewConfig = gridStore.captureViewConfig(props.tabId)
			const t = tab()

			if (updateExisting() && t?.activeViewId && !props.forceNew) {
				const updated = await rpc.views.update({
					id: t.activeViewId,
					name: trimmed,
					config,
				})
				gridStore.setActiveView(props.tabId, updated.id, updated.name)
				props.onSaved(updated.id, updated.name, updated.config)
			} else {
				const created = await rpc.views.save({
					connectionId: props.connectionId,
					schemaName: props.schema,
					tableName: props.table,
					name: trimmed,
					config,
				})
				gridStore.setActiveView(props.tabId, created.id, created.name)
				props.onSaved(created.id, created.name, created.config)
			}

			props.onClose()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setSaving(false)
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !saving()) {
			e.preventDefault()
			handleSave()
		}
	}

	return (
		<Dialog
			open={props.open}
			title={updateExisting() && !props.forceNew ? 'Update Saved View' : 'Save View'}
			onClose={props.onClose}
		>
			<div class="save-view-dialog" onKeyDown={handleKeyDown}>
				<div class="save-view-dialog__field">
					<label class="save-view-dialog__label">View name</label>
					<input
						class="save-view-dialog__input"
						type="text"
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
						placeholder="Enter view name..."
						autofocus
					/>
				</div>

				<Show when={showUpdateCheckbox()}>
					<div class="save-view-dialog__field">
						<label class="save-view-dialog__checkbox-label">
							<input
								type="checkbox"
								checked={updateExisting()}
								onChange={(e) => setUpdateExisting(e.currentTarget.checked)}
							/>
							Update existing view "{tab()?.activeViewName}"
						</label>
					</div>
				</Show>

				<div class="save-view-dialog__summary">
					{configSummary().filters} filter{configSummary().filters !== 1 ? 's' : ''}, {configSummary().sortRules}{' '}
					sort rule{configSummary().sortRules !== 1 ? 's' : ''}, {configSummary().hiddenColumns}{' '}
					hidden column{configSummary().hiddenColumns !== 1 ? 's' : ''}
					{configSummary().colorRules > 0 ? `, ${configSummary().colorRules} color rule${configSummary().colorRules !== 1 ? 's' : ''}` : ''}
				</div>

				<Show when={error()}>
					<div class="save-view-dialog__error">{error()}</div>
				</Show>

				<div class="save-view-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onClose}
					>
						Cancel
					</button>
					<button
						class="btn btn--primary"
						onClick={handleSave}
						disabled={saving() || !name().trim()}
					>
						{saving() ? 'Saving...' : updateExisting() && !props.forceNew ? 'Update' : 'Save'}
					</button>
				</div>
			</div>
		</Dialog>
	)
}
