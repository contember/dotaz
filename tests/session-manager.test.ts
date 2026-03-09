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
})
