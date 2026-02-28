import { Show } from "solid-js";
import "./ConnectionTree.css";

export type TreeItemType = "connection" | "schema" | "table";

interface ConnectionTreeItemProps {
	label: string;
	level: number;
	type: TreeItemType;
	icon?: string;
	expanded?: boolean;
	hasChildren?: boolean;
	statusColor?: string;
	loading?: boolean;
	onClick?: () => void;
	onToggle?: () => void;
	onContextMenu?: (e: MouseEvent) => void;
}

export default function ConnectionTreeItem(props: ConnectionTreeItemProps) {
	function handleClick(e: MouseEvent) {
		e.stopPropagation();
		props.onClick?.();
	}

	function handleToggle(e: MouseEvent) {
		e.stopPropagation();
		props.onToggle?.();
	}

	return (
		<div
			class="tree-item"
			style={{ "padding-left": `${props.level * 16 + 4}px` }}
			onClick={handleClick}
			onContextMenu={props.onContextMenu}
		>
			<Show when={props.hasChildren} fallback={<span class="tree-item__arrow-spacer" />}>
				<button class="tree-item__arrow" onClick={handleToggle}>
					<span
						class="tree-item__arrow-icon"
						classList={{ "tree-item__arrow-icon--expanded": props.expanded }}
					>
						&#x25B6;
					</span>
				</button>
			</Show>

			<Show when={props.loading}>
				<span class="tree-item__spinner" />
			</Show>

			<Show when={!props.loading && props.icon}>
				<span class="tree-item__icon">{props.icon}</span>
			</Show>

			<span class="tree-item__label">{props.label}</span>

			<Show when={props.statusColor}>
				<span
					class="tree-item__status"
					style={{ color: props.statusColor }}
				>
					&#x25CF;
				</span>
			</Show>
		</div>
	);
}
