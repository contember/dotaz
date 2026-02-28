import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { SavedView } from "../../../shared/types/rpc";
import { gridStore } from "../../stores/grid";
import { rpc } from "../../lib/rpc";
import "./SavedViewPicker.css";

interface SavedViewPickerProps {
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
	onSaveView: () => void;
}

export default function SavedViewPicker(props: SavedViewPickerProps) {
	const [open, setOpen] = createSignal(false);
	const [views, setViews] = createSignal<SavedView[]>([]);
	let panelRef: HTMLDivElement | undefined;
	let triggerRef: HTMLButtonElement | undefined;

	const tab = () => gridStore.getTab(props.tabId);

	async function loadViews() {
		try {
			const result = await rpc.views.list({
				connectionId: props.connectionId,
				schemaName: props.schema,
				tableName: props.table,
			});
			setViews(result);
		} catch {
			// Non-critical — picker still works with empty list
		}
	}

	onMount(() => {
		loadViews();
	});

	// Reload views when dropdown opens
	createEffect(() => {
		if (open()) {
			loadViews();
		}
	});

	// Close on click outside
	createEffect(() => {
		if (open()) {
			const handler = (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				if (
					panelRef &&
					!panelRef.contains(target) &&
					triggerRef &&
					!triggerRef.contains(target)
				) {
					setOpen(false);
				}
			};
			document.addEventListener("mousedown", handler);
			onCleanup(() => document.removeEventListener("mousedown", handler));
		}
	});

	async function handleSelectDefault() {
		setOpen(false);
		await gridStore.resetToDefault(props.tabId);
	}

	async function handleSelectView(view: SavedView) {
		setOpen(false);
		gridStore.setActiveView(props.tabId, view.id, view.name);
		await gridStore.applyViewConfig(props.tabId, view.config);
	}

	async function handleDeleteView(e: MouseEvent, view: SavedView) {
		e.stopPropagation();
		try {
			await rpc.views.delete(view.id);
			// If this was the active view, reset to default
			if (tab()?.activeViewId === view.id) {
				gridStore.setActiveView(props.tabId, null, null);
			}
			await loadViews();
		} catch {
			// Ignore delete errors
		}
	}

	function activeViewName(): string {
		return tab()?.activeViewName ?? "Default";
	}

	function isActive(viewId: string): boolean {
		return tab()?.activeViewId === viewId;
	}

	return (
		<div class="saved-view-picker">
			<button
				ref={triggerRef}
				class="saved-view-picker__trigger"
				classList={{ "saved-view-picker__trigger--active": open() }}
				onClick={() => setOpen(!open())}
				title="Saved views"
			>
				<span class="saved-view-picker__icon">{"\u{1D54D}"}</span>
				<span class="saved-view-picker__name">{activeViewName()}</span>
				<span class="saved-view-picker__arrow">{"\u25BE"}</span>
			</button>

			<Show when={open()}>
				<div ref={panelRef} class="saved-view-picker__panel">
					<div
						class="saved-view-picker__item"
						classList={{ "saved-view-picker__item--active": !tab()?.activeViewId }}
						onClick={handleSelectDefault}
					>
						<span class="saved-view-picker__check">
							{!tab()?.activeViewId ? "\u2713" : ""}
						</span>
						<span class="saved-view-picker__item-name">Default</span>
					</div>

					<Show when={views().length > 0}>
						<div class="saved-view-picker__separator" />
						<For each={views()}>
							{(view) => (
								<div
									class="saved-view-picker__item"
									classList={{ "saved-view-picker__item--active": isActive(view.id) }}
									onClick={() => handleSelectView(view)}
								>
									<span class="saved-view-picker__check">
										{isActive(view.id) ? "\u2713" : ""}
									</span>
									<span class="saved-view-picker__item-name">{view.name}</span>
									<button
										class="saved-view-picker__delete"
										onClick={(e) => handleDeleteView(e, view)}
										title="Delete view"
									>
										&times;
									</button>
								</div>
							)}
						</For>
					</Show>

					<div class="saved-view-picker__separator" />
					<div
						class="saved-view-picker__item saved-view-picker__item--action"
						onClick={() => {
							setOpen(false);
							props.onSaveView();
						}}
					>
						<span class="saved-view-picker__check" />
						<span class="saved-view-picker__item-name">Save current view...</span>
					</div>
				</div>
			</Show>
		</div>
	);
}
