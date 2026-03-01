import { createStore } from "solid-js/store";
import type { QueryResult } from "../../shared/types/query";
import { rpc } from "../lib/rpc";
import { isStateless } from "../lib/mode";
import { putHistoryEntry } from "../lib/browser-storage";

// ── Types ─────────────────────────────────────────────────

export type TxMode = "auto-commit" | "manual";

export interface TabEditorState {
	connectionId: string;
	database?: string;
	content: string;
	selectedText: string;
	results: QueryResult[];
	isRunning: boolean;
	error: string | null;
	duration: number;
	queryId: string | null;
	txMode: TxMode;
	inTransaction: boolean;
}

function createDefaultEditorState(connectionId: string, database?: string): TabEditorState {
	return {
		connectionId,
		database,
		content: "",
		selectedText: "",
		results: [],
		isRunning: false,
		error: null,
		duration: 0,
		queryId: null,
		txMode: "auto-commit",
		inTransaction: false,
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

function syncLatestHistory(connectionId: string) {
	if (!isStateless()) return;
	// Fire-and-forget: fetch latest history entry and save to IndexedDB
	rpc.history.list({ connectionId, limit: 1 }).then((entries) => {
		if (entries.length > 0) {
			putHistoryEntry(entries[0]).catch((e) => console.warn("Failed to store history entry:", e));
		}
	}).catch((e) => console.warn("Failed to fetch latest history:", e));
}

async function runQuery(tabId: string, sql: string) {
	const tab = ensureTab(tabId);
	const queryId = crypto.randomUUID();

	setState("tabs", tabId, {
		isRunning: true,
		error: null,
		queryId,
		results: [],
		duration: 0,
	});

	const startTime = performance.now();

	try {
		const results = await rpc.query.execute(tab.connectionId, sql, queryId, undefined, tab.database);

		// Discard stale results if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return;

		const duration = Math.round(performance.now() - startTime);

		setState("tabs", tabId, {
			results,
			duration,
			isRunning: false,
			error: null,
			queryId: null,
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
		});

		syncLatestHistory(tab.connectionId);
	}
}

async function executeQuery(tabId: string) {
	const tab = ensureTab(tabId);
	const sql = tab.content.trim();
	if (!sql) return;

	await runQuery(tabId, sql);
}

async function executeSelected(tabId: string, selectedText: string) {
	ensureTab(tabId);
	const sql = selectedText.trim();
	if (!sql) return;

	await runQuery(tabId, sql);
}

async function cancelQuery(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.isRunning || !tab.queryId) return;

	try {
		await rpc.query.cancel(tab.queryId);
	} catch {
		// Cancellation is best-effort
	}
}

async function formatSql(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.content.trim()) return;

	try {
		const result = await rpc.query.format(tab.content);
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
		await rpc.tx.begin(tab.connectionId, tab.database);
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
		await rpc.tx.commit(tab.connectionId, tab.database);
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
		await rpc.tx.rollback(tab.connectionId, tab.database);
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
	executeQuery,
	executeSelected,
	cancelQuery,
	formatSql,
	setTxMode,
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	removeTab,
};
