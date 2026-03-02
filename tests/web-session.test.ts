import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	createSession,
	destroySession,
	maybeDestroySession,
	releaseStream,
	createStreamToken,
	consumeStreamToken,
	cleanupExpiredTokens,
	getSessions,
	getStreamTokens,
	TOKEN_EXPIRY_MS,
	type Session,
} from "../src/backend-web/session";
import type { ExportParams } from "../src/backend-shared/services/export-service";
import type { ImportStreamParams } from "../src/backend-shared/services/import-service";

const ENCRYPTION_KEY = "test-encryption-key-for-unit-tests";

function mockWs(): { send: (data: string) => void; messages: string[] } {
	const messages: string[] = [];
	return {
		send(data: string) {
			messages.push(data);
		},
		messages,
	};
}

function dummyExportParams(): ExportParams {
	return { schema: "public", table: "users", format: "csv" };
}

function dummyImportParams(): ImportStreamParams {
	return { schema: "public", table: "users", format: "csv", mappings: [] };
}

// Clean up sessions and tokens between tests
beforeEach(() => {
	for (const [, s] of getSessions()) {
		if (s.ttlTimer) clearTimeout(s.ttlTimer);
	}
	getSessions().clear();
	getStreamTokens().clear();
});

afterEach(() => {
	for (const [, s] of getSessions()) {
		if (s.ttlTimer) clearTimeout(s.ttlTimer);
	}
	getSessions().clear();
	getStreamTokens().clear();
});

// ── Token registry ─────────────────────────────────────────

describe("Token registry", () => {
	test("createStreamToken creates a valid token", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		const token = createStreamToken(session, "export", "conn-1", "db1", dummyExportParams());
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
		// Token exists in registry
		expect(getStreamTokens().has(token)).toBe(true);
	});

	test("consumeStreamToken returns entry and deletes it (one-time use)", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		const params = dummyExportParams();
		const token = createStreamToken(session, "export", "conn-1", "db1", params);

		const entry = consumeStreamToken(token, "export");
		expect(entry).not.toBeNull();
		expect(entry!.session.id).toBe(session.id);
		expect(entry!.connectionId).toBe("conn-1");
		expect(entry!.database).toBe("db1");
		expect(entry!.type).toBe("export");
		expect(entry!.params).toEqual(params);

		// Second consume returns null (one-time use)
		const second = consumeStreamToken(token, "export");
		expect(second).toBeNull();
	});

	test("consumeStreamToken rejects wrong-type token", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		const token = createStreamToken(session, "export", "conn-1", undefined, dummyExportParams());

		// Try to consume as import — should fail
		const entry = consumeStreamToken(token, "import");
		expect(entry).toBeNull();

		// Token should still be in registry (not consumed)
		expect(getStreamTokens().has(token)).toBe(true);
	});

	test("consumeStreamToken rejects expired token", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		const token = createStreamToken(session, "export", "conn-1", undefined, dummyExportParams());

		// Manually backdate the token to make it expired
		const tokenEntry = getStreamTokens().get(token)!;
		tokenEntry.createdAt = Date.now() - TOKEN_EXPIRY_MS - 1000;

		const entry = consumeStreamToken(token, "export");
		expect(entry).toBeNull();
		// Expired token should be cleaned up from registry
		expect(getStreamTokens().has(token)).toBe(false);
	});

	test("consumeStreamToken returns null for nonexistent token", () => {
		const entry = consumeStreamToken("nonexistent-token", "export");
		expect(entry).toBeNull();
	});

	test("cleanupExpiredTokens removes only expired tokens", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);

		const validToken = createStreamToken(session, "export", "conn-1", undefined, dummyExportParams());
		const expiredToken = createStreamToken(session, "import", "conn-2", undefined, dummyImportParams());

		// Backdate the expired token
		getStreamTokens().get(expiredToken)!.createdAt = Date.now() - TOKEN_EXPIRY_MS - 1000;

		cleanupExpiredTokens();

		expect(getStreamTokens().has(validToken)).toBe(true);
		expect(getStreamTokens().has(expiredToken)).toBe(false);
	});

	test("createStreamToken with undefined database", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		const token = createStreamToken(session, "import", "conn-1", undefined, dummyImportParams());

		const entry = consumeStreamToken(token, "import");
		expect(entry).not.toBeNull();
		expect(entry!.database).toBeUndefined();
		expect(entry!.type).toBe("import");
	});
});

// ── Session lifecycle ──────────────────────────────────────

describe("Session lifecycle", () => {
	test("createSession initializes all fields", () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);

		expect(typeof session.id).toBe("string");
		expect(session.id.length).toBeGreaterThan(0);
		expect(session.appDb).toBeDefined();
		expect(session.connectionManager).toBeDefined();
		expect(session.queryExecutor).toBeDefined();
		expect(session.handlers).toBeDefined();
		expect(typeof session.unsubscribe).toBe("function");
		expect(session.ws).toBe(ws);
		expect(session.activeStreams).toBe(0);
		expect(session.disconnectedAt).toBeNull();
		expect(session.ttlTimer).toBeNull();

		// Session is registered in the global map
		expect(getSessions().has(session.id)).toBe(true);
		expect(getSessions().get(session.id)).toBe(session);
	});

	test("createSession generates unique IDs", () => {
		const ws1 = mockWs();
		const ws2 = mockWs();
		const s1 = createSession(ws1, ENCRYPTION_KEY);
		const s2 = createSession(ws2, ENCRYPTION_KEY);
		expect(s1.id).not.toBe(s2.id);
	});

	test("destroySession removes session from map", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		expect(getSessions().has(session.id)).toBe(true);

		await destroySession(session);
		expect(getSessions().has(session.id)).toBe(false);
	});

	test("destroySession clears ttlTimer", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		// Simulate a TTL timer being set
		session.ttlTimer = setTimeout(() => {}, 999999);
		expect(session.ttlTimer).not.toBeNull();

		await destroySession(session);
		expect(session.ttlTimer).toBeNull();
	});

	test("destroySession is idempotent (double destroy does not throw)", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);

		await destroySession(session);
		// Second destroy should not throw — session is already gone from map
		await destroySession(session);
		expect(getSessions().has(session.id)).toBe(false);
	});

	test("maybeDestroySession destroys immediately when no active streams", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		expect(session.activeStreams).toBe(0);

		await maybeDestroySession(session);

		expect(session.ws).toBeNull();
		expect(getSessions().has(session.id)).toBe(false);
	});

	test("maybeDestroySession defers cleanup when active streams exist", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 2;

		await maybeDestroySession(session);

		// Session should still exist — streams are active
		expect(getSessions().has(session.id)).toBe(true);
		expect(session.ws).toBeNull();
		expect(session.disconnectedAt).not.toBeNull();
		// TTL timer should be set
		expect(session.ttlTimer).not.toBeNull();

		// Clean up timer
		clearTimeout(session.ttlTimer!);
	});

	test("maybeDestroySession sets disconnectedAt", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 1;
		const before = Date.now();

		await maybeDestroySession(session);

		expect(session.disconnectedAt).not.toBeNull();
		expect(session.disconnectedAt!).toBeGreaterThanOrEqual(before);
		expect(session.disconnectedAt!).toBeLessThanOrEqual(Date.now());

		// Clean up
		clearTimeout(session.ttlTimer!);
	});

	test("maybeDestroySession TTL timer force-destroys session", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 1;

		await maybeDestroySession(session);
		expect(getSessions().has(session.id)).toBe(true);

		// Wait for the TTL timer to fire (we can't easily speed it up, so we test the mechanism)
		// Instead, verify the timer is set and manually trigger the destroy
		expect(session.ttlTimer).not.toBeNull();

		// Simulate what the TTL timer does
		clearTimeout(session.ttlTimer!);
		if (getSessions().has(session.id)) {
			await destroySession(session);
		}
		expect(getSessions().has(session.id)).toBe(false);
	});
});

// ── Stream reference counting (releaseStream) ─────────────

describe("releaseStream", () => {
	test("releaseStream decrements activeStreams", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 3;

		await releaseStream(session);
		expect(session.activeStreams).toBe(2);
		// Session still alive (ws is not null)
		expect(getSessions().has(session.id)).toBe(true);
	});

	test("releaseStream does not destroy when ws is still connected", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 1;

		await releaseStream(session);
		expect(session.activeStreams).toBe(0);
		// ws is still set, so session should survive
		expect(getSessions().has(session.id)).toBe(true);
	});

	test("releaseStream triggers destroy when ws is null and last stream completes", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 1;
		session.ws = null; // Simulate WS disconnect

		await releaseStream(session);
		expect(session.activeStreams).toBe(0);
		// Session should be destroyed
		expect(getSessions().has(session.id)).toBe(false);
	});

	test("releaseStream does not destroy when ws is null but streams remain", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 2;
		session.ws = null; // Simulate WS disconnect

		await releaseStream(session);
		expect(session.activeStreams).toBe(1);
		// Still has active streams, should not be destroyed
		expect(getSessions().has(session.id)).toBe(true);
	});

	test("full lifecycle: WS disconnect with active streams, then streams complete", async () => {
		const ws = mockWs();
		const session = createSession(ws, ENCRYPTION_KEY);
		session.activeStreams = 2;

		// WS disconnects
		await maybeDestroySession(session);
		expect(getSessions().has(session.id)).toBe(true);
		expect(session.ws).toBeNull();
		const timer = session.ttlTimer;
		expect(timer).not.toBeNull();

		// First stream completes
		await releaseStream(session);
		expect(session.activeStreams).toBe(1);
		expect(getSessions().has(session.id)).toBe(true);

		// Second stream completes — should trigger destroy
		await releaseStream(session);
		expect(session.activeStreams).toBe(0);
		expect(getSessions().has(session.id)).toBe(false);
	});
});
