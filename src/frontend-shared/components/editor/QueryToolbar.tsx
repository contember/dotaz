import { Show } from "solid-js";
import { editorStore, type TxMode } from "../../stores/editor";
import { connectionsStore } from "../../stores/connections";
import Play from "lucide-solid/icons/play";
import ListTree from "lucide-solid/icons/list-tree";
import AlignLeft from "lucide-solid/icons/text-align-start";
import PlayCircle from "lucide-solid/icons/circle-play";
import Check from "lucide-solid/icons/check";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Icon from "../common/Icon";
import "./QueryToolbar.css";

interface QueryToolbarProps {
	tabId: string;
	connectionId: string;
	database?: string;
	onOpenHistory?: () => void;
}

export default function QueryToolbar(props: QueryToolbarProps) {
	const tab = () => editorStore.getTab(props.tabId);
	const connection = () =>
		connectionsStore.connections.find((c) => c.id === props.connectionId);

	const isRunning = () => tab()?.isRunning ?? false;
	const hasContent = () => (tab()?.content.trim().length ?? 0) > 0;
	const duration = () => tab()?.duration ?? 0;
	const txMode = () => tab()?.txMode ?? "auto-commit";
	const inTransaction = () => tab()?.inTransaction ?? false;

	function handleRun() {
		editorStore.executeQuery(props.tabId);
	}

	function handleRunStatement() {
		editorStore.executeStatement(props.tabId);
	}

	function handleCancel() {
		editorStore.cancelQuery(props.tabId);
	}

	function handleExplain() {
		editorStore.explainQuery(props.tabId, false);
	}

	function handleExplainAnalyze() {
		editorStore.explainQuery(props.tabId, true);
	}

	function handleFormat() {
		editorStore.formatSql(props.tabId);
	}

	function handleTxModeChange(mode: TxMode) {
		editorStore.setTxMode(props.tabId, mode);
	}

	function handleBeginTx() {
		editorStore.beginTransaction(props.tabId);
	}

	function handleCommit() {
		editorStore.commitTransaction(props.tabId);
	}

	function handleRollback() {
		editorStore.rollbackTransaction(props.tabId);
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms} ms`;
		return `${(ms / 1000).toFixed(1)} s`;
	}

	return (
		<div class="query-toolbar">
			{/* Run / Cancel */}
			<Show
				when={!isRunning()}
				fallback={
					<button
						class="query-toolbar__btn query-toolbar__btn--cancel"
						onClick={handleCancel}
						title="Cancel query (Esc)"
					>
						<Icon name="stop" size={12} /> Cancel
					</button>
				}
			>
				<button
					class="query-toolbar__btn query-toolbar__btn--run"
					onClick={handleRun}
					disabled={!hasContent()}
					title="Run All (Ctrl+Enter)"
				>
					<Icon name="play" size={12} /> Run
				</button>
			</Show>

			{/* Run Statement */}
			<button
				class="query-toolbar__btn"
				onClick={handleRunStatement}
				disabled={!hasContent() || isRunning()}
				title="Run Statement (Ctrl+Shift+Enter)"
			>
				<Play size={12} /> Run Statement
			</button>

			{/* Explain */}
			<button
				class="query-toolbar__btn"
				onClick={handleExplain}
				disabled={!hasContent() || isRunning()}
				title="Explain (Ctrl+E)"
			>
				<ListTree size={12} /> Explain
			</button>

			{/* Explain Analyze */}
			<button
				class="query-toolbar__btn"
				onClick={handleExplainAnalyze}
				disabled={!hasContent() || isRunning()}
				title="Explain Analyze (Ctrl+Shift+E)"
			>
				<ListTree size={12} /> Analyze
			</button>

			{/* Format */}
			<button
				class="query-toolbar__btn"
				onClick={handleFormat}
				disabled={!hasContent() || isRunning()}
				title="Format SQL"
			>
				<AlignLeft size={12} /> Format
			</button>

			{/* History */}
			<Show when={props.onOpenHistory}>
				<button
					class="query-toolbar__btn"
					onClick={props.onOpenHistory}
					title="Query History"
				>
					<Icon name="history" size={12} /> History
				</button>
			</Show>

			<div class="query-toolbar__separator" />

			{/* Transaction mode toggle */}
			<div class="query-toolbar__tx-toggle">
				<button
					class={`query-toolbar__tx-option${txMode() === "auto-commit" ? " query-toolbar__tx-option--active" : ""}`}
					onClick={() => handleTxModeChange("auto-commit")}
					title="Auto-commit mode"
				>
					Auto
				</button>
				<button
					class={`query-toolbar__tx-option${txMode() === "manual" ? " query-toolbar__tx-option--active" : ""}`}
					onClick={() => handleTxModeChange("manual")}
					title="Manual transaction mode"
				>
					Manual
				</button>
			</div>

			{/* Manual transaction controls */}
			<Show when={txMode() === "manual"}>
				<Show
					when={inTransaction()}
					fallback={
						<button
							class="query-toolbar__btn"
							onClick={handleBeginTx}
							title="Begin Transaction"
						>
							<PlayCircle size={12} /> Begin
						</button>
					}
				>
					<div class="query-toolbar__tx-indicator">TXN</div>
					<button
						class="query-toolbar__btn"
						onClick={handleCommit}
						title="Commit Transaction"
					>
						<Check size={12} /> Commit
					</button>
					<button
						class="query-toolbar__btn"
						onClick={handleRollback}
						title="Rollback Transaction"
					>
						<RotateCcw size={12} /> Rollback
					</button>
				</Show>
			</Show>

			<div class="query-toolbar__separator" />

			{/* Connection info */}
			<div class="query-toolbar__connection">
				<span class="query-toolbar__connection-name">
					{connection()?.name ?? "—"}
					<Show when={props.database}>
						<span style={{ color: "var(--ink-muted)" }}> / {props.database}</span>
					</Show>
				</span>
			</div>

			<div class="query-toolbar__spacer" />

			{/* Duration */}
			<Show when={duration() > 0}>
				<div class="query-toolbar__duration">
					{formatDuration(duration())}
				</div>
			</Show>
		</div>
	);
}
