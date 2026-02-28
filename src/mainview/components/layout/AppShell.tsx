import { createSignal, type JSX } from "solid-js";
import "./AppShell.css";

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(
		parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width")) || 250,
	);
	const [isResizing, setIsResizing] = createSignal(false);

	const minWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-min-width")) || 150;
	const maxWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-max-width")) || 500;

	function onResizerMouseDown(e: MouseEvent) {
		e.preventDefault();
		setIsResizing(true);

		const onMouseMove = (e: MouseEvent) => {
			const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX));
			setSidebarWidth(newWidth);
		};

		const onMouseUp = () => {
			setIsResizing(false);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}

	const shellStyle = (): JSX.CSSProperties => ({
		"grid-template-columns": `${sidebarWidth()}px var(--resizer-width) 1fr`,
	});

	return (
		<div
			class="app-shell"
			style={shellStyle()}
			classList={{ "is-resizing": isResizing() }}
		>
			<aside class="sidebar">
				<div class="sidebar-header">Connections</div>
				<div class="sidebar-content" />
			</aside>

			<div class="resizer" onMouseDown={onResizerMouseDown} />

			<main class="main-content" />

			<footer class="status-bar">
				<span class="status-bar-item">Dotaz</span>
			</footer>
		</div>
	);
}
