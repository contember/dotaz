import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const sqliteConfig: SqliteConnectionConfig = {
	type: 'sqlite',
	path: ':memory:',
}

describe('SessionManager', () => {
	let appDb: AppDatabase
	let cm: ConnectionManager
	let sm: SessionManager
	let connectionId: string

	beforeEach(async () => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
		cm = new ConnectionManager(appDb)
		sm = new SessionManager(cm, appDb)

		const conn = cm.createConnection({ name: 'Test', config: sqliteConfig })
		connectionId = conn.id
		await cm.connect(connectionId)
	})

	afterEach(async () => {
		sm.dispose()
		await cm.disconnectAll()
		AppDatabase.resetInstance()
	})

	// ── Create / Destroy lifecycle ───────────────────────────

	test('createSession returns session info', async () => {
		const session = await sm.createSession(connectionId)
		expect(session.sessionId).toBeTruthy()
		expect(session.connectionId).toBe(connectionId)
		expect(session.label).toBe('Session 1')
		expect(session.inTransaction).toBe(false)
		expect(session.createdAt).toBeGreaterThan(0)
	})

	test('createSession increments labels', async () => {
		const s1 = await sm.createSession(connectionId)
		const s2 = await sm.createSession(connectionId)
		expect(s1.label).toBe('Session 1')
		expect(s2.label).toBe('Session 2')
	})

	test('createSession reserves session on driver', async () => {
		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		expect(driver.getSessionIds()).toContain(session.sessionId)
	})

	test('destroySession removes session', async () => {
		const session = await sm.createSession(connectionId)
		await sm.destroySession(session.sessionId)
		expect(sm.getSession(session.sessionId)).toBeUndefined()
	})

	test('destroySession releases session on driver', async () => {
		const session = await sm.createSession(connectionId)
		const sessionId = session.sessionId
		await sm.destroySession(sessionId)
		const driver = cm.getDriver(connectionId)
		expect(driver.getSessionIds()).not.toContain(sessionId)
	})

	test('destroySession throws for unknown session', async () => {
		await expect(sm.destroySession('nonexistent')).rejects.toThrow(
			'Session not found: nonexistent',
		)
	})

	// ── Max sessions enforcement ─────────────────────────────

	test('enforces max sessions per connection', async () => {
		// Default is 5
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)

		await expect(sm.createSession(connectionId)).rejects.toThrow(
			'Maximum sessions per connection (5) reached',
		)
	})

	test('respects custom maxSessionsPerConnection setting', async () => {
		appDb.setSetting('maxSessionsPerConnection', '2')

		await sm.createSession(connectionId)
		await sm.createSession(connectionId)

		await expect(sm.createSession(connectionId)).rejects.toThrow(
			'Maximum sessions per connection (2) reached',
		)
	})

	test('allows creating after destroying when at limit', async () => {
		appDb.setSetting('maxSessionsPerConnection', '1')

		const s1 = await sm.createSession(connectionId)
		await sm.destroySession(s1.sessionId)

		// Should work now
		const s2 = await sm.createSession(connectionId)
		expect(s2.sessionId).toBeTruthy()
	})

	// ── listSessions ─────────────────────────────────────────

	test('listSessions returns empty for unknown connection', () => {
		expect(sm.listSessions('nonexistent')).toEqual([])
	})

	test('listSessions returns all sessions for a connection', async () => {
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)
		const sessions = sm.listSessions(connectionId)
		expect(sessions.length).toBe(2)
	})

	test('listSessions reflects inTransaction state', async () => {
		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		const sessions = sm.listSessions(connectionId)
		const found = sessions.find(s => s.sessionId === session.sessionId)
		expect(found?.inTransaction).toBe(true)

		await driver.rollback(session.sessionId)
	})

	// ── getSession ───────────────────────────────────────────

	test('getSession returns undefined for unknown session', () => {
		expect(sm.getSession('nonexistent')).toBeUndefined()
	})

	test('getSession returns session info', async () => {
		const session = await sm.createSession(connectionId)
		const retrieved = sm.getSession(session.sessionId)
		expect(retrieved).toBeDefined()
		expect(retrieved!.sessionId).toBe(session.sessionId)
		expect(retrieved!.connectionId).toBe(connectionId)
	})

	// ── handleConnectionLost ─────────────────────────────────

	test('handleConnectionLost clears all sessions for connection', async () => {
		await sm.createSession(connectionId)
		await sm.createSession(connectionId)
		expect(sm.listSessions(connectionId).length).toBe(2)

		sm.handleConnectionLost(connectionId)
		expect(sm.listSessions(connectionId)).toEqual([])
	})

	test('handleConnectionLost does not affect other connections', async () => {
		const conn2 = cm.createConnection({ name: 'Test2', config: sqliteConfig })
		await cm.connect(conn2.id)

		await sm.createSession(connectionId)
		await sm.createSession(conn2.id)

		sm.handleConnectionLost(connectionId)

		expect(sm.listSessions(connectionId)).toEqual([])
		expect(sm.listSessions(conn2.id).length).toBe(1)
	})

	// ── handleConnectionRestored ─────────────────────────────

	test('handleConnectionRestored recreates sessions after disconnect', async () => {
		const s1 = await sm.createSession(connectionId)
		const s2 = await sm.createSession(connectionId)

		sm.handleConnectionLost(connectionId)
		expect(sm.listSessions(connectionId)).toEqual([])

		const restored = await sm.handleConnectionRestored(connectionId)
		expect(restored.length).toBe(2)
		expect(restored[0].label).toBe(s1.label)
		expect(restored[1].label).toBe(s2.label)
		expect(restored[0].connectionId).toBe(connectionId)
		expect(restored[0].inTransaction).toBe(false)
	})

	test('handleConnectionRestored reserves sessions on driver', async () => {
		await sm.createSession(connectionId)

		sm.handleConnectionLost(connectionId)
		const restored = await sm.handleConnectionRestored(connectionId)

		const driver = cm.getDriver(connectionId)
		expect(driver.getSessionIds()).toContain(restored[0].sessionId)
	})

	test('handleConnectionRestored returns empty if no prior sessions', async () => {
		sm.handleConnectionLost(connectionId)
		const restored = await sm.handleConnectionRestored(connectionId)
		expect(restored).toEqual([])
	})

	test('handleConnectionRestored is idempotent', async () => {
		await sm.createSession(connectionId)

		sm.handleConnectionLost(connectionId)
		const first = await sm.handleConnectionRestored(connectionId)
		const second = await sm.handleConnectionRestored(connectionId)

		expect(first.length).toBe(1)
		expect(second).toEqual([])
	})

	// ── Idle transaction timeout ────────────────────────────

	test('auto-rollbacks idle transactions after timeout', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '1')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)
		expect(driver.inTransaction(session.sessionId)).toBe(true)

		// First check: records the transaction as first-seen
		await (sm as any).checkIdleTransactions()
		expect(driver.inTransaction(session.sessionId)).toBe(true)

		// Wait for timeout to elapse
		await new Promise(r => setTimeout(r, 5))

		// Second check: timeout exceeded, should auto-rollback
		await (sm as any).checkIdleTransactions()
		expect(driver.inTransaction(session.sessionId)).toBe(false)
	})

	test('does not rollback transactions within timeout', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '60000')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		// First check: records first-seen
		await (sm as any).checkIdleTransactions()
		// Second check: should still be within timeout
		await (sm as any).checkIdleTransactions()

		expect(driver.inTransaction(session.sessionId)).toBe(true)
		await driver.rollback(session.sessionId)
	})

	test('clears idle tracking when transaction ends normally', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '1')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		// First check: records first-seen
		await (sm as any).checkIdleTransactions()

		// Commit normally
		await driver.commit(session.sessionId)

		// Check clears tracking since no longer in tx
		await (sm as any).checkIdleTransactions()
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(false)
	})

	test('idle tracking cleaned up on destroySession', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '60000')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		await (sm as any).checkIdleTransactions()
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(true)

		await sm.destroySession(session.sessionId)
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(false)
	})

	test('idle tracking cleaned up on handleConnectionLost', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '60000')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		await (sm as any).checkIdleTransactions()
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(true)

		sm.handleConnectionLost(connectionId)
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(false)
	})

	// ── handleSessionDead ──────────────────────────────────

	test('handleSessionDead removes session from tracking', async () => {
		const session = await sm.createSession(connectionId)
		expect(sm.getSession(session.sessionId)).toBeDefined()

		sm.handleSessionDead(session.sessionId)
		expect(sm.getSession(session.sessionId)).toBeUndefined()
	})

	test('handleSessionDead cleans up txFirstSeen', async () => {
		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		await (sm as any).checkIdleTransactions()
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(true)

		sm.handleSessionDead(session.sessionId)
		expect((sm as any).txFirstSeen.has(session.sessionId)).toBe(false)
	})

	test('handleSessionDead does not throw for unknown session', () => {
		expect(() => sm.handleSessionDead('nonexistent')).not.toThrow()
	})

	test('handleSessionDead does not affect other sessions', async () => {
		const s1 = await sm.createSession(connectionId)
		const s2 = await sm.createSession(connectionId)

		sm.handleSessionDead(s1.sessionId)
		expect(sm.getSession(s1.sessionId)).toBeUndefined()
		expect(sm.getSession(s2.sessionId)).toBeDefined()
	})

	test('listSessions excludes dead sessions', async () => {
		await sm.createSession(connectionId)
		const s2 = await sm.createSession(connectionId)

		sm.handleSessionDead(s2.sessionId)
		const sessions = sm.listSessions(connectionId)
		expect(sessions.length).toBe(1)
	})

	// ── Idle transaction timeout ────────────────────────────

	test('idle check is disabled when timeout is 0', async () => {
		appDb.setSetting('idleTransactionTimeoutMs', '0')

		const session = await sm.createSession(connectionId)
		const driver = cm.getDriver(connectionId)
		await driver.beginTransaction(session.sessionId)

		await (sm as any).checkIdleTransactions()
		await (sm as any).checkIdleTransactions()

		// Transaction should still be active — timeout disabled
		expect(driver.inTransaction(session.sessionId)).toBe(true)
		await driver.rollback(session.sessionId)
	})
})
