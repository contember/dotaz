import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { QueryHistoryEntry } from "../../../shared/types/query";
import { storage } from "../../lib/storage";
import { connectionsStore } from "../../stores/connections";
import { tabsStore } from "../../stores/tabs";
import { editorStore } from "../../stores/editor";
import Play from "lucide-solid/icons/play";
import Copy from "lucide-solid/icons/copy";
import ClipboardPaste from "lucide-solid/icons/clipboard-paste";
import Trash2 from "lucide-solid/icons/trash-2";
import Dialog from "../common/Dialog";
import Icon from "../common/Icon";
import "./QueryHistory.css";

interface QueryHistoryProps {
	open: boolean;
	onClose: () => void;
}

const PAGE_SIZE = 50;
const SQL_TRUNCATE_LENGTH = 120;
const TOAST_DURATION = 1500;

export default function QueryHistory(props: QueryHistoryProps) {
	const [entries, setEntries] = createSignal<QueryHistoryEntry[]>([]);
	const [search, setSearch] = createSignal("");
	const [connectionFilter, setConnectionFilter] = createSignal("");
	const [expandedId, setExpandedId] = createSignal<number | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(true);
	const [toast, setToast] = createSignal<string | null>(null);

	let listRef: HTMLDivElement | undefined;
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	// Load initial data when dialog opens
	createEffect(() => {
		if (props.open) {
			setEntries([]);
			setExpandedId(null);
			setHasMore(true);
			loadEntries(true);
		}
	});

	onCleanup(() => {
		if (searchDebounce) clearTimeout(searchDebounce);
	});

	async function loadEntries(reset: boolean) {
		if (loading()) return;
		setLoading(true);

		try {
			const offset = reset ? 0 : entries().length;
			const result = await storage.listHistory({
				search: search() || undefined,
				connectionId: connectionFilter() || undefined,
				limit: PAGE_SIZE,
				offset,
			});

			if (reset) {
				setEntries(result);
			} else {
				setEntries((prev) => [...prev, ...result]);
			}
			setHasMore(result.length === PAGE_SIZE);
		} catch {
			// Non-critical — silently fail
		} finally {
			setLoading(false);
		}
	}

	function handleSearchInput(value: string) {
		setSearch(value);
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			setEntries([]);
			setHasMore(true);
			loadEntries(true);
		}, 300);
	}

	function handleConnectionFilterChange(value: string) {
		setConnectionFilter(value);
		setEntries([]);
		setHasMore(true);
		loadEntries(true);
	}

	function handleScroll(e: Event) {
		const el = e.currentTarget as HTMLDivElement;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
		if (nearBottom && hasMore() && !loading()) {
			loadEntries(false);
		}
	}

	function toggleExpand(id: number) {
		setExpandedId((current) => (current === id ? null : id));
	}

	function connectionName(connectionId: string): string {
		const conn = connectionsStore.connections.find((c) => c.id === connectionId);
		return conn?.name ?? "Unknown";
	}

	function formatTimestamp(iso: string): string {
		try {
			const date = new Date(iso);
			const now = new Date();
			const isToday =
				date.getFullYear() === now.getFullYear() &&
				date.getMonth() === now.getMonth() &&
				date.getDate() === now.getDate();

			if (isToday) {
				return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
			}
			return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
				" " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		} catch {
			return iso;
		}
	}

	function formatDuration(ms?: number): string {
		if (ms == null) return "";
		if (ms < 1000) return `${ms} ms`;
		return `${(ms / 1000).toFixed(1)} s`;
	}

	function truncateSql(sql: string): string {
		const oneLine = sql.replace(/\s+/g, " ").trim();
		if (oneLine.length <= SQL_TRUNCATE_LENGTH) return oneLine;
		return oneLine.slice(0, SQL_TRUNCATE_LENGTH) + "...";
	}

	function showToast(message: string) {
		setToast(message);
		setTimeout(() => setToast(null), TOAST_DURATION);
	}

	async function handleCopyToClipboard(entry: QueryHistoryEntry) {
		try {
			await navigator.clipboard.writeText(entry.sql);
			showToast("Copied to clipboard");
		} catch {
			// Clipboard access denied
		}
	}

	function handleCopyToConsole(entry: QueryHistoryEntry) {
		// Find active SQL console tab
		const activeTab = tabsStore.activeTab;
		if (activeTab && activeTab.type === "sql-console") {
			editorStore.setContent(activeTab.id, entry.sql);
			showToast("Copied to console");
			props.onClose();
			return;
		}

		// No active SQL console — open a new one
		handleRunAgain(entry);
	}

	function handleRunAgain(entry: QueryHistoryEntry) {
		const tabId = tabsStore.openTab({
			type: "sql-console",
			title: "SQL Console",
			connectionId: entry.connectionId,
		});
		editorStore.initTab(tabId, entry.connectionId);
		editorStore.setContent(tabId, entry.sql);
		props.onClose();
	}

	async function handleClearHistory() {
		const confirmed = window.confirm(
			connectionFilter()
				? `Clear history for "${connectionName(connectionFilter())}"?`
				: "Clear all query history?",
		);
		if (!confirmed) return;

		try {
			const connId = connectionFilter() || undefined;
			await storage.clearHistory(connId);
			setEntries([]);
			setHasMore(false);
		} catch {
			// Non-critical
		}
	}

	// Get unique connected connections for the filter dropdown
	const connectedConnections = () =>
		connectionsStore.connections.filter((c) => c.state === "connected");

	return (
		<Dialog
			open={props.open}
			title="Query History"
			onClose={props.onClose}
		>
			<div class="query-history">
				{/* Filters */}
				<div class="query-history__filters">
					<input
						class="query-history__search"
						type="text"
						placeholder="Search SQL..."
						value={search()}
						onInput={(e) => handleSearchInput(e.currentTarget.value)}
					/>
					<select
						class="query-history__connection-filter"
						value={connectionFilter()}
						onChange={(e) => handleConnectionFilterChange(e.currentTarget.value)}
					>
						<option value="">All connections</option>
						<For each={connectedConnections()}>
							{(conn) => (
								<option value={conn.id}>{conn.name}</option>
							)}
						</For>
					</select>
					<button
						class="query-history__clear-btn"
						onClick={handleClearHistory}
						disabled={entries().length === 0 && !loading()}
						title={connectionFilter() ? "Clear history for this connection" : "Clear all history"}
					>
						<Trash2 size={12} /> Clear
					</button>
				</div>

				{/* Entry list */}
				<div
					class="query-history__list"
					ref={listRef}
					onScroll={handleScroll}
				>
					<Show when={entries().length === 0 && !loading()}>
						<div class="empty-state">
							<Icon name="history" size={28} class="empty-state__icon" />
							<div class="empty-state__title">
								{search() || connectionFilter()
									? "No matching queries"
									: "No history yet"}
							</div>
							<div class="empty-state__subtitle">
								{search() || connectionFilter()
									? "Try different search terms or filters."
									: "Queries you run will appear here."}
							</div>
						</div>
					</Show>

					<For each={entries()}>
						{(entry) => {
							const isExpanded = () => expandedId() === entry.id;

							return (
								<div
									class="query-history__entry"
									classList={{ "query-history__entry--expanded": isExpanded() }}
								>
									<div
										class="query-history__entry-header"
										onClick={() => toggleExpand(entry.id)}
									>
										<span
											class="query-history__status-icon"
											classList={{
												"query-history__status-icon--success": entry.status === "success",
												"query-history__status-icon--error": entry.status === "error",
											}}
											title={entry.status === "error" ? entry.errorMessage : "Success"}
										>
											<Icon name={entry.status === "success" ? "check" : "error"} size={12} />
										</span>
										<span class="query-history__sql-preview">
											{truncateSql(entry.sql)}
										</span>
										<span class="query-history__meta">
											<Show when={entry.durationMs != null}>
												<span class="query-history__duration">
													{formatDuration(entry.durationMs)}
												</span>
											</Show>
											<Show when={entry.rowCount != null}>
												<span class="query-history__row-count">
													{entry.rowCount} row{entry.rowCount !== 1 ? "s" : ""}
												</span>
											</Show>
										</span>
									</div>

									<div class="query-history__entry-info">
										<span class="query-history__connection-name">
											{connectionName(entry.connectionId)}
										</span>
										<span class="query-history__timestamp">
											{formatTimestamp(entry.executedAt)}
										</span>
									</div>

									<Show when={isExpanded()}>
										<div class="query-history__expanded">
											<pre class="query-history__full-sql">{entry.sql}</pre>
											<Show when={entry.status === "error" && entry.errorMessage}>
												<div class="query-history__error-message">
													{entry.errorMessage}
												</div>
											</Show>
											<div class="query-history__actions">
												<button
													class="query-history__action-btn"
													onClick={() => handleRunAgain(entry)}
													title="Open in new SQL console"
												>
													<Play size={12} /> Run Again
												</button>
												<button
													class="query-history__action-btn"
													onClick={() => handleCopyToClipboard(entry)}
													title="Copy SQL to clipboard"
												>
													<Copy size={12} /> Copy to Clipboard
												</button>
												<button
													class="query-history__action-btn"
													onClick={() => handleCopyToConsole(entry)}
													title="Insert SQL into active console"
												>
													<ClipboardPaste size={12} /> Copy to Console
												</button>
											</div>
										</div>
									</Show>
								</div>
							);
						}}
					</For>

					<Show when={loading()}>
						<div class="query-history__loading">
							<Icon name="spinner" size={14} />
							Loading...
						</div>
					</Show>
				</div>

				{/* Toast */}
				<Show when={toast()}>
					<div class="query-history__toast">{toast()}</div>
				</Show>
			</div>
		</Dialog>
	);
}
