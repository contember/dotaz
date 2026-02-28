import { type JSX, Show } from "solid-js";
import Icon from "../common/Icon";
import "./Sidebar.css";

interface SidebarProps {
	width: number;
	collapsed: boolean;
	onToggleCollapse: () => void;
	onAdd?: () => void;
	children?: JSX.Element;
}

export default function Sidebar(props: SidebarProps) {
	return (
		<aside
			class="sidebar"
			classList={{ "sidebar--collapsed": props.collapsed }}
			style={{ width: props.collapsed ? "0px" : `${props.width}px` }}
		>
			<Show when={!props.collapsed}>
				<div class="sidebar-header">
					<span class="sidebar-header__title">Connections</span>
					<div class="sidebar-header__actions">
						<Show when={props.onAdd}>
							<button
								class="sidebar-header__btn"
								onClick={props.onAdd}
								title="Add connection"
							>
								<Icon name="plus" size={14} />
							</button>
						</Show>
						<button
							class="sidebar-header__btn"
							onClick={props.onToggleCollapse}
							title="Collapse sidebar"
						>
							<Icon name="chevron-left" size={14} />
						</button>
					</div>
				</div>
				<div class="sidebar-content">
					{props.children}
				</div>
			</Show>
		</aside>
	);
}

export function SidebarExpandButton(props: { onClick: () => void }) {
	return (
		<button
			class="sidebar-expand-btn"
			onClick={props.onClick}
			title="Expand sidebar"
		>
			<Icon name="chevron-right" size={14} />
		</button>
	);
}
