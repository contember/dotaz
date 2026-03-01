import { createStore } from "solid-js/store";
import type { QueryResult } from "../../shared/types/query";
import { rpc } from "../lib/rpc";
import { isStateless } from "../lib/mode";
import { putHistoryEntry } from "../lib/browser-storage";
import { getStatementAtCursor } from "../lib/sql-utils";

// ── Types ─────────────────────────────────────────────────

export type TxMode = "auto-commit" | "manual";

export interface TabEditorState {
	connectionId: string;
	database?: string;
	content: string;
	selectedText: string;
	cursorPosition: number;
	results: QueryResult[];
	isRunning: boolean;
	error: string | null;
	duration: number;
	queryId: string | null;
	txMode: TxMode;
	inTransaction: boolean;
	/** Range of the last executed statement (for visual flash feedback) */
	executedRange: { from: number; to: number } | null;
	/** Error position in the editor (character offset, 0-based) for highlighting */
	errorOffset: number | null;
}

function createDefaultEditorState(connectionId: string, database?: string): TabEditorState {
	return {
		connectionId,
		database,
		content: "",
		selectedText: "",
		cursorPosition: 0,
		results: [],
		isRunning: false,
		error: null,
		duration: 0,
		queryId: null,
		txMode: "auto-commit",
		inTransaction: false,
		executedRange: null,
		errorOffset: null,
	};
}

// ── Store ─────────────────────────────────────────────────

interface EditorStoreState {
	tabs: Record<string, TabEditorState>;
}

const [state, setState] = createStore<EditorStoreState>({
	tabs: {},
});

// ── Internal helpers ──────────────────────────────────────

function getTab(tabId: string): TabEditorState | undefined {
	return state.tabs[tabId];
}

function ensureTab(tabId: string): TabEditorState {
	const tab = getTab(tabId);
	if (!tab) {
		throw new Error(`Editor state not found for tab ${tabId}`);
	}
	return tab;
}

// ── Actions ───────────────────────────────────────────────

function initTab(tabId: string, connectionId: string, database?: string) {
	if (!getTab(tabId)) {
		setState("tabs", tabId, createDefaultEditorState(connectionId, database));
	}
}

function setContent(tabId: string, content: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "content", content);
}

function setSelectedText(tabId: string, selectedText: string) {
	ensureTab(tabId);
	setState("tabs", tabId, "selectedText", selectedText);
}

function setCursorPosition(tabId: string, position: number) {
	ensureTab(tabId);
	setState("tabs", tabId, "cursorPosition", position);
}

function syncLatestHistory(connectionId: string) {
	if (!isStateless()) return;
	// Fire-and-forget: fetch latest history entry and save to IndexedDB
	rpc.history.list({ connectionId, limit: 1 }).then((entries) => {
		if (entries.length > 0) {
			putHistoryEntry(entries[0]).catch((e) => console.warn("Failed to store history entry:", e));
		}
	}).catch((e) => console.warn("Failed to fetch latest history:", e));
}

async function runQuery(tabId: string, sql: string, baseOffset = 0) {
	const tab = ensureTab(tabId);
	const queryId = crypto.randomUUID();

	setState("tabs", tabId, {
		isRunning: true,
		error: null,
		queryId,
		results: [],
		duration: 0,
		errorOffset: null,
	});

	const startTime = performance.now();

	try {
		const results = await rpc.query.execute({ connectionId: tab.connectionId, sql, queryId, database: tab.database });

		// Discard stale results if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return;

		const duration = Math.round(performance.now() - startTime);

		// Extract error position from the first result that has an error
		const errorResult = results.find((r) => r.error && r.errorPosition);
		const errorOffset = errorResult?.errorPosition?.offset != null
			? baseOffset + errorResult.errorPosition.offset - 1 // Convert 1-based to 0-based
			: null;

		setState("tabs", tabId, {
			results,
			duration,
			isRunning: false,
			error: null,
			queryId: null,
			errorOffset,
		});

		syncLatestHistory(tab.connectionId);
	} catch (err) {
		// Discard stale errors if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return;

		const duration = Math.round(performance.now() - startTime);
		const errorMessage = err instanceof Error ? err.message : String(err);

		setState("tabs", tabId, {
			error: errorMessage,
			duration,
			isRunning: false,
			queryId: null,
			errorOffset: null,
		});

		syncLatestHistory(tab.connectionId);
	}
}

async function executeQuery(tabId: string) {
	const tab = ensureTab(tabId);
	const sql = tab.content.trim();
	if (!sql) return;

	// Base offset accounts for leading whitespace stripped by trim()
	const baseOffset = tab.content.length - tab.content.trimStart().length;
	await runQuery(tabId, sql, baseOffset);
}

async function executeSelected(tabId: string, selectedText: string) {
	ensureTab(tabId);
	const sql = selectedText.trim();
	if (!sql) return;

	await runQuery(tabId, sql);
}

async function executeStatement(tabId: string) {
	const tab = ensureTab(tabId);
	// If text is selected, run that; otherwise detect statement at cursor
	if (tab.selectedText.trim()) {
		await runQuery(tabId, tab.selectedText.trim());
		return;
	}
	const result = getStatementAtCursor(tab.content, tab.cursorPosition);
	if (result) {
		setState("tabs", tabId, "executedRange", { from: result.from, to: result.to });
		await runQuery(tabId, result.text, result.from);
	}
}

async function cancelQuery(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.isRunning || !tab.queryId) return;

	try {
		await rpc.query.cancel({ queryId: tab.queryId });
	} catch {
		// Cancellation is best-effort
	}
}

async function formatSql(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.content.trim()) return;

	try {
		const result = await rpc.query.format({ sql: tab.content });
		setState("tabs", tabId, "content", result.sql);
	} catch {
		// Format failure is non-critical
	}
}

function setTxMode(tabId: string, mode: TxMode) {
	ensureTab(tabId);
	setState("tabs", tabId, "txMode", mode);
}

async function beginTransaction(tabId: string) {
	const tab = ensureTab(tabId);
	try {
		await rpc.tx.begin({ connectionId: tab.connectionId, database: tab.database });
		setState("tabs", tabId, "inTransaction", true);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		setState("tabs", tabId, "error", errorMessage);
	}
}

async function commitTransaction(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.inTransaction) return;

	try {
		await rpc.tx.commit({ connectionId: tab.connectionId, database: tab.database });
		setState("tabs", tabId, "inTransaction", false);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		setState("tabs", tabId, "error", errorMessage);
	}
}

async function rollbackTransaction(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.inTransaction) return;

	try {
		await rpc.tx.rollback({ connectionId: tab.connectionId, database: tab.database });
		setState("tabs", tabId, "inTransaction", false);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		setState("tabs", tabId, "error", errorMessage);
	}
}

function removeTab(tabId: string) {
	setState("tabs", tabId, undefined!);
}

// ── Export ─────────────────────────────────────────────────

export const editorStore = {
	getTab,
	initTab,
	setContent,
	setSelectedText,
	setCursorPosition,
	executeQuery,
	executeSelected,
	executeStatement,
	cancelQuery,
	formatSql,
	setTxMode,
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	removeTab,
};
