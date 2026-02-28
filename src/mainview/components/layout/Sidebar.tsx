import { type JSX, Show } from "solid-js";
import "./Sidebar.css";

interface SidebarProps {
	width: number;
	collapsed: boolean;
	onToggleCollapse: () => void;
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
					<button
						class="sidebar-header__toggle"
						onClick={props.onToggleCollapse}
						title="Collapse sidebar"
					>
						&#x276E;
					</button>
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
			&#x276F;
		</button>
	);
}
