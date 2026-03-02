import { createStore } from "solid-js/store";
import type { SessionInfo } from "../../shared/types/rpc";
import { rpc } from "../lib/rpc";
import { uiStore } from "./ui";
import { settingsStore } from "./settings";

// ── Types ─────────────────────────────────────────────────

export type ConnectionMode = "pool" | "pinned-per-tab" | "single-session";
export type AutoPin = "on-begin" | "on-set-session" | "never";
export type AutoUnpin = "on-commit" | "never";

// ── Store ─────────────────────────────────────────────────

interface SessionStoreState {
	sessions: Record<string, SessionInfo>;
	tabSessions: Record<string, string>; // tabId → sessionId
}

const [state, setState] = createStore<SessionStoreState>({
	sessions: {},
	tabSessions: {},
});

// ── Auto-pin SQL detection ────────────────────────────────

const BEGIN_PATTERN = /^\s*(BEGIN|START\s+TRANSACTION)\b/i;
const SET_SESSION_PATTERN = /^\s*SET\s+(?!LOCAL\b)/i;
const CREATE_TEMP_PATTERN = /^\s*CREATE\s+(TEMP|TEMPORARY)\b/i;

function shouldAutoPin(sql: string, autoPin: AutoPin): boolean {
	if (autoPin === "never") return false;
	if (BEGIN_PATTERN.test(sql)) return true;
	if (autoPin === "on-set-session") {
		if (SET_SESSION_PATTERN.test(sql)) return true;
		if (CREATE_TEMP_PATTERN.test(sql)) return true;
	}
	return false;
}

// ── Auto-unpin detection ──────────────────────────────────

const COMMIT_ROLLBACK_PATTERN = /^\s*(COMMIT|ROLLBACK|END)\b/i;

function shouldAutoUnpin(sql: string): boolean {
	return COMMIT_ROLLBACK_PATTERN.test(sql);
}

// ── Actions ───────────────────────────────────────────────

async function pinSession(connectionId: string, tabId: string, database?: string): Promise<string | undefined> {
	try {
		const session = await rpc.session.create({ connectionId, database });
		setState("sessions", session.sessionId, session);
		setState("tabSessions", tabId, session.sessionId);
		return session.sessionId;
	} catch (err) {
		uiStore.addToast("error", `Failed to create session: ${err instanceof Error ? err.message : err}`);
		return undefined;
	}
}

async function unpinSession(tabId: string): Promise<void> {
	const sessionId = state.tabSessions[tabId];
	if (!sessionId) return;

	// Unbind this tab
	setState("tabSessions", tabId, undefined!);

	// Check if any other tabs still use this session
	const stillUsed = Object.values(state.tabSessions).some((sid) => sid === sessionId);
	if (!stillUsed) {
		try {
			await rpc.session.destroy({ sessionId });
		} catch (err) {
			console.debug("Failed to destroy session:", err);
		}
		setState("sessions", sessionId, undefined!);
	}
}

function shareSession(sessionId: string, tabId: string): void {
	if (!state.sessions[sessionId]) return;
	setState("tabSessions", tabId, sessionId);
}

function getSessionForTab(tabId: string): string | undefined {
	return state.tabSessions[tabId];
}

function isTabPinned(tabId: string): boolean {
	return tabId in state.tabSessions && state.tabSessions[tabId] !== undefined;
}

function listSessionsForConnection(connectionId: string): SessionInfo[] {
	return Object.values(state.sessions).filter(
		(s) => s && s.connectionId === connectionId,
	);
}

function getSession(sessionId: string): SessionInfo | undefined {
	return state.sessions[sessionId];
}

function getSessionLabelForTab(tabId: string): string | undefined {
	const sessionId = state.tabSessions[tabId];
	if (!sessionId) return undefined;
	return state.sessions[sessionId]?.label;
}

async function handleTabClosed(tabId: string): Promise<void> {
	await unpinSession(tabId);
}

/**
 * Auto-pin check: call before executing a query.
 * Returns the sessionId to use (existing, newly created, or undefined for pool).
 */
async function resolveSessionForExecution(
	tabId: string,
	connectionId: string,
	sql: string,
	database?: string,
): Promise<string | undefined> {
	// Already pinned → use existing session
	const existing = state.tabSessions[tabId];
	if (existing) return existing;

	const mode = settingsStore.sessionConfig.defaultConnectionMode;
	const autoPin = settingsStore.sessionConfig.autoPin;

	// "pinned-per-tab": auto-create on first query
	if (mode === "pinned-per-tab") {
		return await pinSession(connectionId, tabId, database);
	}

	// "single-session": share one session per connection
	if (mode === "single-session") {
		const existing = listSessionsForConnection(connectionId);
		if (existing.length > 0) {
			shareSession(existing[0].sessionId, tabId);
			return existing[0].sessionId;
		}
		return await pinSession(connectionId, tabId, database);
	}

	// "pool" mode: check auto-pin
	if (shouldAutoPin(sql, autoPin)) {
		return await pinSession(connectionId, tabId, database);
	}

	return undefined;
}

/**
 * Auto-unpin check: call after executing a query.
 * Destroys the session if auto-unpin is configured and SQL was COMMIT/ROLLBACK.
 */
async function checkAutoUnpin(tabId: string, sql: string): Promise<void> {
	const autoUnpin = settingsStore.sessionConfig.autoUnpin;
	if (autoUnpin !== "on-commit") return;
	if (!isTabPinned(tabId)) return;
	if (shouldAutoUnpin(sql)) {
		await unpinSession(tabId);
	}
}

/**
 * Handle backend session.changed notification (e.g., connection lost).
 */
function handleSessionChanged(event: { connectionId: string; sessions: SessionInfo[] }): void {
	const backendIds = new Set(event.sessions.map((s) => s.sessionId));

	// Update existing sessions for this connection
	for (const session of event.sessions) {
		setState("sessions", session.sessionId, session);
	}

	// Remove sessions that no longer exist on the backend
	for (const [sessionId, session] of Object.entries(state.sessions)) {
		if (session && session.connectionId === event.connectionId && !backendIds.has(sessionId)) {
			setState("sessions", sessionId, undefined!);

			// Unbind any tabs pointing to this session
			for (const [tabId, sid] of Object.entries(state.tabSessions)) {
				if (sid === sessionId) {
					setState("tabSessions", tabId, undefined!);
				}
			}
		}
	}
}

/**
 * Clear all sessions for a connection (e.g., on disconnect).
 */
function clearSessionsForConnection(connectionId: string): void {
	for (const [sessionId, session] of Object.entries(state.sessions)) {
		if (session && session.connectionId === connectionId) {
			setState("sessions", sessionId, undefined!);

			for (const [tabId, sid] of Object.entries(state.tabSessions)) {
				if (sid === sessionId) {
					setState("tabSessions", tabId, undefined!);
				}
			}
		}
	}
}

// ── Export ─────────────────────────────────────────────────

export const sessionStore = {
	get sessions() { return state.sessions; },
	get tabSessions() { return state.tabSessions; },
	pinSession,
	unpinSession,
	shareSession,
	getSessionForTab,
	isTabPinned,
	listSessionsForConnection,
	getSession,
	getSessionLabelForTab,
	handleTabClosed,
	resolveSessionForExecution,
	checkAutoUnpin,
	handleSessionChanged,
	clearSessionsForConnection,
};
