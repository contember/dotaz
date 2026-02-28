import { For, Show, onMount, onCleanup } from "solid-js";
import "./ContextMenu.css";

export interface ContextMenuItem {
	label: string;
	action: () => void;
	disabled?: boolean;
}

export type ContextMenuEntry = ContextMenuItem | "separator";

interface ContextMenuProps {
	x: number;
	y: number;
	items: ContextMenuEntry[];
	onClose: () => void;
}

export default function ContextMenu(props: ContextMenuProps) {
	let menuRef: HTMLDivElement | undefined;

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			props.onClose();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			props.onClose();
		}
	}

	function clampPosition() {
		if (!menuRef) return;
		const rect = menuRef.getBoundingClientRect();
		const maxX = window.innerWidth - rect.width;
		const maxY = window.innerHeight - rect.height;
		if (props.x > maxX) {
			menuRef.style.left = `${maxX}px`;
		}
		if (props.y > maxY) {
			menuRef.style.top = `${maxY}px`;
		}
	}

	onMount(() => {
		clampPosition();
		// Use setTimeout to avoid catching the same right-click event
		setTimeout(() => {
			document.addEventListener("mousedown", handleClickOutside);
		}, 0);
		document.addEventListener("keydown", handleKeyDown);
	});

	onCleanup(() => {
		document.removeEventListener("mousedown", handleClickOutside);
		document.removeEventListener("keydown", handleKeyDown);
	});

	return (
		<div
			ref={menuRef}
			class="context-menu"
			style={{ left: `${props.x}px`, top: `${props.y}px` }}
		>
			<For each={props.items}>
				{(item) => (
					<Show
						when={item !== "separator"}
						fallback={<div class="context-menu__separator" />}
					>
						<button
							class="context-menu__item"
							classList={{ "context-menu__item--disabled": (item as ContextMenuItem).disabled }}
							onClick={() => {
								const menuItem = item as ContextMenuItem;
								if (!menuItem.disabled) {
									menuItem.action();
									props.onClose();
								}
							}}
						>
							{(item as ContextMenuItem).label}
						</button>
					</Show>
				)}
			</For>
		</div>
	);
}
