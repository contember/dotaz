import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { QueryResult, ExplainResult } from "../../shared/types/query";
import { rpc, friendlyErrorMessage } from "../lib/rpc";
import { storage } from "../lib/storage";
import { createTabHelpers } from "../lib/tab-store-helpers";
import { getStatementAtCursor } from "../lib/sql-utils";
import { splitStatements, detectDestructiveWithoutWhere } from "../../shared/sql/statements";
import { connectionsStore } from "./connections";
import { uiStore } from "./ui";

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
	/** EXPLAIN plan result (when explain mode is used instead of run) */
	explainResult: ExplainResult | null;
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
		explainResult: null,
	};
}

// ── Store ─────────────────────────────────────────────────

interface EditorStoreState {
	tabs: Record<string, TabEditorState>;
}

const [state, setState] = createStore<EditorStoreState>({
	tabs: {},
});

// ── Destructive query confirmation ────────────────────────

export interface PendingDestructiveQuery {
	tabId: string;
	sql: string;
	baseOffset: number;
	statements: string[];
}

const [pendingDestructiveQuery, setPendingDestructiveQuery] = createSignal<PendingDestructiveQuery | null>(null);
let suppressDestructiveWarning = false;

/**
 * Check if any statements in the SQL are destructive (DELETE/UPDATE) without WHERE.
 * Returns the list of dangerous statements, or empty array if safe.
 */
function findDestructiveStatements(sql: string): string[] {
	const statements = splitStatements(sql);
	return statements.filter(detectDestructiveWithoutWhere);
}

const DML_PATTERN = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i;

/**
 * Check if any statement in the SQL is a DML/DDL statement.
 */
function containsDmlStatements(sql: string): boolean {
	const statements = splitStatements(sql);
	return statements.some((s) => DML_PATTERN.test(s));
}

// ── Internal helpers ──────────────────────────────────────

const { getTab, ensureTab } = createTabHelpers(() => state.tabs, "Editor");

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

function recordHistory(connectionId: string, sql: string, results: QueryResult[]) {
	const hasError = results.some((r) => r.error);
	const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
	const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount ?? 0), 0);
	storage.addHistoryEntry({
		connectionId,
		sql,
		status: hasError ? "error" : "success",
		durationMs: Math.round(totalDuration),
		rowCount: totalRows,
		errorMessage: results.find((r) => r.error)?.error,
		executedAt: new Date().toISOString(),
	}).catch((e) => {
		console.debug("Failed to record history:", e);
		uiStore.addToast("warning", "Failed to save query history. Changes may not persist.");
	});
}

async function runQuery(tabId: string, sql: string, baseOffset = 0) {
	const tab = ensureTab(tabId);
	const queryId = crypto.randomUUID();

	setState("tabs", tabId, {
		isRunning: true,
		error: null,
		queryId,
		results: [],
		explainResult: null,
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

		recordHistory(tab.connectionId, sql, results);
	} catch (err) {
		// Discard stale errors if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return;

		const duration = Math.round(performance.now() - startTime);
		const errorMessage = friendlyErrorMessage(err);

		setState("tabs", tabId, {
			error: errorMessage,
			duration,
			isRunning: false,
			queryId: null,
			errorOffset: null,
		});

		recordHistory(tab.connectionId, sql, [{
			columns: [],
			rows: [],
			rowCount: 0,
			durationMs: duration,
			error: errorMessage,
		}]);
	}
}

function checkAndRunQuery(tabId: string, sql: string, baseOffset = 0) {
	const tab = getTab(tabId);
	if (tab && connectionsStore.isReadOnly(tab.connectionId) && containsDmlStatements(sql)) {
		uiStore.addToast("warning", "This connection is read-only. DML/DDL statements are not allowed.");
		return;
	}
	if (!suppressDestructiveWarning) {
		const dangerous = findDestructiveStatements(sql);
		if (dangerous.length > 0) {
			setPendingDestructiveQuery({ tabId, sql, baseOffset, statements: dangerous });
			return;
		}
	}
	runQuery(tabId, sql, baseOffset);
}

async function executeQuery(tabId: string) {
	const tab = ensureTab(tabId);
	const sql = tab.content.trim();
	if (!sql) return;

	// Base offset accounts for leading whitespace stripped by trim()
	const baseOffset = tab.content.length - tab.content.trimStart().length;
	checkAndRunQuery(tabId, sql, baseOffset);
}

async function executeSelected(tabId: string, selectedText: string) {
	ensureTab(tabId);
	const sql = selectedText.trim();
	if (!sql) return;

	checkAndRunQuery(tabId, sql);
}

async function executeStatement(tabId: string) {
	const tab = ensureTab(tabId);
	// If text is selected, run that; otherwise detect statement at cursor
	if (tab.selectedText.trim()) {
		checkAndRunQuery(tabId, tab.selectedText.trim());
		return;
	}
	const result = getStatementAtCursor(tab.content, tab.cursorPosition);
	if (result) {
		setState("tabs", tabId, "executedRange", { from: result.from, to: result.to });
		checkAndRunQuery(tabId, result.text, result.from);
	}
}

function confirmDestructiveQuery(suppressForSession = false) {
	const pending = pendingDestructiveQuery();
	if (!pending) return;
	if (suppressForSession) {
		suppressDestructiveWarning = true;
	}
	setPendingDestructiveQuery(null);
	runQuery(pending.tabId, pending.sql, pending.baseOffset);
}

function cancelDestructiveQuery() {
	setPendingDestructiveQuery(null);
}

async function cancelQuery(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.isRunning || !tab.queryId) return;

	try {
		await rpc.query.cancel({ queryId: tab.queryId });
	} catch (err) {
		console.debug("Query cancellation failed:", err instanceof Error ? err.message : err);
	}
}

async function formatSql(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.content.trim()) return;

	try {
		const result = await rpc.query.format({ sql: tab.content });
		setState("tabs", tabId, "content", result.sql);
	} catch (err) {
		console.debug("SQL format failed:", err instanceof Error ? err.message : err);
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
		setState("tabs", tabId, "error", friendlyErrorMessage(err));
	}
}

async function commitTransaction(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.inTransaction) return;

	try {
		await rpc.tx.commit({ connectionId: tab.connectionId, database: tab.database });
		setState("tabs", tabId, "inTransaction", false);
	} catch (err) {
		setState("tabs", tabId, "error", friendlyErrorMessage(err));
	}
}

async function rollbackTransaction(tabId: string) {
	const tab = ensureTab(tabId);
	if (!tab.inTransaction) return;

	try {
		await rpc.tx.rollback({ connectionId: tab.connectionId, database: tab.database });
		setState("tabs", tabId, "inTransaction", false);
	} catch (err) {
		setState("tabs", tabId, "error", friendlyErrorMessage(err));
	}
}

async function explainQuery(tabId: string, analyze = false) {
	const tab = ensureTab(tabId);
	let sql = tab.selectedText.trim();
	if (!sql) {
		const result = getStatementAtCursor(tab.content, tab.cursorPosition);
		sql = result?.text ?? tab.content.trim();
	}
	if (!sql) return;

	setState("tabs", tabId, {
		isRunning: true,
		error: null,
		results: [],
		explainResult: null,
		duration: 0,
		errorOffset: null,
	});

	try {
		const explainResult = await rpc.query.explain({
			connectionId: tab.connectionId,
			sql,
			analyze,
			database: tab.database,
		});

		setState("tabs", tabId, {
			explainResult,
			duration: explainResult.durationMs,
			isRunning: false,
			error: explainResult.error ?? null,
		});
	} catch (err) {
		const errorMessage = friendlyErrorMessage(err);
		setState("tabs", tabId, {
			error: errorMessage,
			isRunning: false,
			explainResult: null,
		});
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
	explainQuery,
	formatSql,
	setTxMode,
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	removeTab,
	get pendingDestructiveQuery() {
		return pendingDestructiveQuery();
	},
	confirmDestructiveQuery,
	cancelDestructiveQuery,
};
