import { createEffect, createSignal, Show } from "solid-js";
import type { SavedViewConfig } from "../../../shared/types/rpc";
import { gridStore } from "../../stores/grid";
import { rpc } from "../../lib/rpc";
import Dialog from "../common/Dialog";
import "./SaveViewDialog.css";

interface SaveViewDialogProps {
	open: boolean;
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
	onClose: () => void;
	onSaved: () => void;
}

export default function SaveViewDialog(props: SaveViewDialogProps) {
	const [name, setName] = createSignal("");
	const [updateExisting, setUpdateExisting] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const tab = () => gridStore.getTab(props.tabId);

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			const t = tab();
			if (t?.activeViewId && t?.activeViewName) {
				setName(t.activeViewName);
				setUpdateExisting(true);
			} else {
				setName("");
				setUpdateExisting(false);
			}
			setError(null);
			setSaving(false);
		}
	});

	function configSummary(): { filters: number; sortRules: number; hiddenColumns: number } {
		const t = tab();
		if (!t) return { filters: 0, sortRules: 0, hiddenColumns: 0 };
		const hiddenCount = t.columns.filter(
			(col) => t.columnConfig[col.name]?.visible === false,
		).length;
		return {
			filters: t.filters.length,
			sortRules: t.sort.length,
			hiddenColumns: hiddenCount,
		};
	}

	async function handleSave() {
		const trimmed = name().trim();
		if (!trimmed) {
			setError("View name is required");
			return;
		}

		setSaving(true);
		setError(null);

		try {
			const config: SavedViewConfig = gridStore.captureViewConfig(props.tabId);
			const t = tab();

			if (updateExisting() && t?.activeViewId) {
				const updated = await rpc.views.update({
					id: t.activeViewId,
					name: trimmed,
					config,
				});
				gridStore.setActiveView(props.tabId, updated.id, updated.name);
			} else {
				const created = await rpc.views.save({
					connectionId: props.connectionId,
					schemaName: props.schema,
					tableName: props.table,
					name: trimmed,
					config,
				});
				gridStore.setActiveView(props.tabId, created.id, created.name);
			}

			props.onSaved();
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && !saving()) {
			e.preventDefault();
			handleSave();
		}
	}

	return (
		<Dialog
			open={props.open}
			title={updateExisting() ? "Update Saved View" : "Save View"}
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

				<Show when={tab()?.activeViewId}>
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
					{configSummary().filters} filter{configSummary().filters !== 1 ? "s" : ""},
					{" "}{configSummary().sortRules} sort rule{configSummary().sortRules !== 1 ? "s" : ""},
					{" "}{configSummary().hiddenColumns} hidden column{configSummary().hiddenColumns !== 1 ? "s" : ""}
				</div>

				<Show when={error()}>
					<div class="save-view-dialog__error">{error()}</div>
				</Show>

				<div class="save-view-dialog__actions">
					<button
						class="save-view-dialog__btn save-view-dialog__btn--secondary"
						onClick={props.onClose}
					>
						Cancel
					</button>
					<button
						class="save-view-dialog__btn save-view-dialog__btn--primary"
						onClick={handleSave}
						disabled={saving() || !name().trim()}
					>
						{saving() ? "Saving..." : updateExisting() ? "Update" : "Save"}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
