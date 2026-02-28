import { createSignal, Show } from "solid-js";
import Sidebar, { SidebarExpandButton } from "./Sidebar";
import Resizer from "./Resizer";
import TabBar from "./TabBar";
import StatusBar from "./StatusBar";
import ConnectionTree from "../connection/ConnectionTree";
import ConnectionDialog from "../connection/ConnectionDialog";
import type { ConnectionInfo } from "../../../shared/types/connection";
import { tabsStore } from "../../stores/tabs";
import "./AppShell.css";

const MIN_WIDTH = 150;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 250;

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(DEFAULT_WIDTH);
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
	const [dialogOpen, setDialogOpen] = createSignal(false);
	const [connectionToEdit, setConnectionToEdit] = createSignal<ConnectionInfo | null>(null);

	function handleResize(deltaX: number) {
		setSidebarWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + deltaX)));
	}

	function toggleCollapse() {
		setSidebarCollapsed((c) => !c);
	}

	function openAddConnectionDialog() {
		setConnectionToEdit(null);
		setDialogOpen(true);
	}

	function openEditConnectionDialog(conn: ConnectionInfo) {
		setConnectionToEdit(conn);
		setDialogOpen(true);
	}

	return (
		<div class="app-shell">
			<div class="app-shell__body">
				<Show when={sidebarCollapsed()}>
					<SidebarExpandButton onClick={toggleCollapse} />
				</Show>

				<Sidebar
					width={sidebarWidth()}
					collapsed={sidebarCollapsed()}
					onToggleCollapse={toggleCollapse}
					onAdd={openAddConnectionDialog}
				>
					<ConnectionTree onAddConnection={openAddConnectionDialog} onEditConnection={openEditConnectionDialog} />
				</Sidebar>

				<Show when={!sidebarCollapsed()}>
					<Resizer onResize={handleResize} />
				</Show>

				<div class="app-shell__main">
					<TabBar
						tabs={tabsStore.openTabs}
						activeTabId={tabsStore.activeTabId}
						onSelectTab={tabsStore.setActiveTab}
						onCloseTab={tabsStore.closeTab}
						onCloseOtherTabs={tabsStore.closeOtherTabs}
						onCloseAllTabs={tabsStore.closeAllTabs}
						onRenameTab={tabsStore.renameTab}
					/>
					<main class="main-content">
						<Show when={tabsStore.openTabs.length === 0}>
							<div class="welcome-screen">
								<h2 class="welcome-screen__title">Dotaz</h2>
								<p class="welcome-screen__subtitle">
									Open a connection and select a table to get started.
								</p>
							</div>
						</Show>
					</main>
				</div>
			</div>

			<StatusBar />

			<ConnectionDialog
				open={dialogOpen()}
				connection={connectionToEdit()}
				onClose={() => setDialogOpen(false)}
			/>
		</div>
	);
}
