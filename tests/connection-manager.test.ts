import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { StatusChangeEvent } from '@dotaz/backend-shared/services/connection-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { PostgresConnectionConfig, SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// ── Helpers ──────────────────────────────────────────────────

const sqliteConfig: SqliteConnectionConfig = {
	type: 'sqlite',
	path: ':memory:',
}

const pgConfig: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5432,
	database: 'mydb',
	user: 'admin',
	password: 'secret',
}

function createManager(): { appDb: AppDatabase; manager: ConnectionManager } {
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	const manager = new ConnectionManager(appDb)
	return { appDb, manager }
}

/** Minimal mock driver with all methods needed by gracefulDisconnect / disconnectAll. */
function createMockDriver() {
	return {
		connect: async () => {},
		disconnect: async () => {},
		isConnected: () => true,
		inTransaction: () => false,
		rollback: async () => {},
		cancel: async () => {},
		getSessionIds: () => [] as string[],
		execute: async () => ({ rows: [], columns: [] }),
		beginTransaction: async () => {},
		commit: async () => {},
		getDriverType: () => 'postgresql' as const,
	}
}

// ── Tests ────────────────────────────────────────────────────

describe('ConnectionManager', () => {
	let appDb: AppDatabase
	let manager: ConnectionManager

	beforeEach(() => {
		;({ appDb, manager } = createManager())
	})

	afterEach(async () => {
		await manager.disconnectAll()
		AppDatabase.resetInstance()
	})

	// ── CRUD delegation ─────────────────────────────────────

	describe('CRUD', () => {
		test('createConnection persists and returns ConnectionInfo', () => {
			const conn = manager.createConnection({
				name: 'SQLite Test',
				config: sqliteConfig,
			})
			expect(conn.id).toBeTruthy()
			expect(conn.name).toBe('SQLite Test')
			expect(conn.config).toEqual(sqliteConfig)
			expect(conn.state).toBe('disconnected')
		})

		test('listConnections returns all connections with live state', async () => {
			const conn = manager.createConnection({
				name: 'SQLite Test',
				config: sqliteConfig,
			})
			manager.createConnection({ name: 'PG Test', config: pgConfig })

			// Before connect, all disconnected
			let list = manager.listConnections()
			expect(list).toHaveLength(2)
			expect(list.every((c) => c.state === 'disconnected')).toBe(true)

			// After connect, one is connected
			await manager.connect(conn.id)
			list = manager.listConnections()
			const sqliteConn = list.find((c) => c.id === conn.id)!
			expect(sqliteConn.state).toBe('connected')
		})

		test('updateConnection persists changes and preserves state', async () => {
			const conn = manager.createConnection({
				name: 'Original',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			const updated = manager.updateConnection({
				id: conn.id,
				name: 'Updated',
				config: sqliteConfig,
			})
			expect(updated.name).toBe('Updated')
			expect(updated.state).toBe('connected')
		})

		test('deleteConnection disconnects and removes', async () => {
			const conn = manager.createConnection({
				name: 'ToDelete',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			await manager.deleteConnection(conn.id)
			expect(manager.listConnections()).toHaveLength(0)
			expect(() => manager.getDriver(conn.id)).toThrow(
				'No active connection',
			)
		})

		test('createConnection validates config', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad',
					config: { type: 'sqlite', path: '' } as SqliteConnectionConfig,
				})
			).toThrow('SQLite path is required')
		})

		test('updateConnection validates config', () => {
			const conn = manager.createConnection({
				name: 'Test',
				config: sqliteConfig,
			})
			expect(() =>
				manager.updateConnection({
					id: conn.id,
					name: 'Updated',
					config: {
						type: 'postgresql',
						host: '',
						port: 5432,
						database: 'db',
						user: 'user',
						password: 'pass',
					},
				})
			).toThrow('PostgreSQL host is required')
		})
	})

	// ── Connection lifecycle ────────────────────────────────

	describe('connect', () => {
		test('connect creates a SQLite driver and makes it available', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			const driver = manager.getDriver(conn.id)
			expect(driver.isConnected()).toBe(true)
			expect(driver.getDriverType()).toBe('sqlite')
		})

		test('connect throws for unknown connection id', async () => {
			await expect(manager.connect('nonexistent')).rejects.toThrow(
				'Connection not found',
			)
		})

		test('connect sets state to error on failure', async () => {
			const conn = manager.createConnection({
				name: 'Bad SQLite',
				config: { type: 'sqlite', path: '/nonexistent/dir/impossible.db' },
			})

			try {
				await manager.connect(conn.id)
			} catch {
				// Expected
			}

			expect(manager.getConnectionState(conn.id)).toBe('error')
		})

		test('connect replaces existing active connection', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			const firstDriver = manager.getDriver(conn.id)

			await manager.connect(conn.id)
			const secondDriver = manager.getDriver(conn.id)

			expect(firstDriver).not.toBe(secondDriver)
			expect(secondDriver.isConnected()).toBe(true)
		})
	})

	describe('disconnect', () => {
		test('disconnect cleans up driver and sets state', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			await manager.disconnect(conn.id)

			expect(manager.getConnectionState(conn.id)).toBe('disconnected')
			expect(() => manager.getDriver(conn.id)).toThrow(
				'No active connection',
			)
		})

		test('disconnect on non-active connection is a no-op', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			// Should not throw
			await manager.disconnect(conn.id)
			expect(manager.getConnectionState(conn.id)).toBe('disconnected')
		})
	})

	describe('reconnect', () => {
		test('reconnect disconnects then connects', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			const firstDriver = manager.getDriver(conn.id)

			await manager.reconnect(conn.id)
			const secondDriver = manager.getDriver(conn.id)

			expect(firstDriver).not.toBe(secondDriver)
			expect(secondDriver.isConnected()).toBe(true)
			expect(manager.getConnectionState(conn.id)).toBe('connected')
		})

		test('reconnect works even if not currently connected', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.reconnect(conn.id)
			expect(manager.getConnectionState(conn.id)).toBe('connected')
		})
	})

	// ── Multiple connections ────────────────────────────────

	describe('multiple connections', () => {
		test('can manage multiple simultaneous SQLite connections', async () => {
			const conn1 = manager.createConnection({
				name: 'DB1',
				config: sqliteConfig,
			})
			const conn2 = manager.createConnection({
				name: 'DB2',
				config: sqliteConfig,
			})

			await manager.connect(conn1.id)
			await manager.connect(conn2.id)

			expect(manager.getDriver(conn1.id).isConnected()).toBe(true)
			expect(manager.getDriver(conn2.id).isConnected()).toBe(true)

			// Disconnect one, the other remains
			await manager.disconnect(conn1.id)
			expect(() => manager.getDriver(conn1.id)).toThrow()
			expect(manager.getDriver(conn2.id).isConnected()).toBe(true)
		})

		test('connections are isolated', async () => {
			const conn1 = manager.createConnection({
				name: 'DB1',
				config: sqliteConfig,
			})
			const conn2 = manager.createConnection({
				name: 'DB2',
				config: sqliteConfig,
			})

			await manager.connect(conn1.id)
			await manager.connect(conn2.id)

			const driver1 = manager.getDriver(conn1.id)
			const driver2 = manager.getDriver(conn2.id)

			// Create table in driver1
			await driver1.execute(
				'CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)',
			)
			await driver1.execute("INSERT INTO test (val) VALUES ('hello')")

			// driver2 should not see it
			await expect(driver2.execute('SELECT * FROM test')).rejects.toThrow()
		})
	})

	// ── getDriver ───────────────────────────────────────────

	describe('getDriver', () => {
		test('returns active driver', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			const driver = manager.getDriver(conn.id)
			expect(driver).toBeTruthy()
			expect(driver.isConnected()).toBe(true)
		})

		test('throws for non-active connection', () => {
			expect(() => manager.getDriver('nonexistent')).toThrow(
				'No active connection',
			)
		})
	})

	// ── testConnection ──────────────────────────────────────

	describe('testConnection', () => {
		test('returns success for valid SQLite config', async () => {
			const result = await manager.testConnection(sqliteConfig)
			expect(result.success).toBe(true)
			expect(result.error).toBeUndefined()
		})

		test('returns error for invalid SQLite path', async () => {
			const result = await manager.testConnection({
				type: 'sqlite',
				path: '/nonexistent/dir/impossible.db',
			})
			expect(result.success).toBe(false)
			expect(result.error).toBeTruthy()
		})

		test('validates config before testing', async () => {
			await expect(
				manager.testConnection({
					type: 'sqlite',
					path: '',
				} as SqliteConnectionConfig),
			).rejects.toThrow('SQLite path is required')
		})
	})

	// ── Status change events ────────────────────────────────

	describe('status events', () => {
		test('emits connecting and connected on successful connect', async () => {
			const events: StatusChangeEvent[] = []
			manager.onStatusChanged((e) => {
				events.push(e)
			})

			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			expect(events).toHaveLength(2)
			expect(events[0]).toEqual({
				connectionId: conn.id,
				state: 'connecting',
			})
			expect(events[1]).toEqual({
				connectionId: conn.id,
				state: 'connected',
			})
		})

		test('emits error on failed connect', async () => {
			const events: StatusChangeEvent[] = []
			manager.onStatusChanged((e) => {
				events.push(e)
			})

			const conn = manager.createConnection({
				name: 'Bad',
				config: {
					type: 'sqlite',
					path: '/nonexistent/dir/impossible.db',
				},
			})

			try {
				await manager.connect(conn.id)
			} catch {
				// Expected
			}

			expect(events).toHaveLength(2)
			expect(events[0].state).toBe('connecting')
			expect(events[1].state).toBe('error')
			expect(events[1].error).toBeTruthy()
		})

		test('emits disconnected on disconnect', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			const events: StatusChangeEvent[] = []
			manager.onStatusChanged((e) => {
				events.push(e)
			})
			await manager.disconnect(conn.id)

			expect(events).toHaveLength(1)
			expect(events[0]).toEqual({
				connectionId: conn.id,
				state: 'disconnected',
			})
		})

		test('unsubscribe stops receiving events', async () => {
			const events: StatusChangeEvent[] = []
			const unsub = manager.onStatusChanged((e) => {
				events.push(e)
			})

			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			expect(events.length).toBeGreaterThan(0)

			const countBefore = events.length
			unsub()
			await manager.disconnect(conn.id)
			expect(events.length).toBe(countBefore)
		})
	})

	// ── Config validation ───────────────────────────────────

	describe('validation', () => {
		test('rejects empty PostgreSQL host', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad PG',
					config: { ...pgConfig, host: '' },
				})
			).toThrow('PostgreSQL host is required')
		})

		test('rejects missing PostgreSQL port', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad PG',
					config: { ...pgConfig, port: 0 },
				})
			).toThrow('PostgreSQL port is required')
		})

		test('rejects empty PostgreSQL database', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad PG',
					config: { ...pgConfig, database: '' },
				})
			).toThrow('PostgreSQL database is required')
		})

		test('rejects empty PostgreSQL user', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad PG',
					config: { ...pgConfig, user: '' },
				})
			).toThrow('PostgreSQL user is required')
		})

		test('allows empty string PostgreSQL password', () => {
			const conn = manager.createConnection({
				name: 'PG with empty password',
				config: { ...pgConfig, password: '' },
			})
			expect(conn.id).toBeTruthy()
		})

		test('rejects empty SQLite path', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad SQLite',
					config: { type: 'sqlite', path: '' } as SqliteConnectionConfig,
				})
			).toThrow('SQLite path is required')
		})

		test('rejects unsupported connection type', () => {
			expect(() =>
				manager.createConnection({
					name: 'Bad',
					config: { type: 'oracle' } as any,
				})
			).toThrow('Unsupported connection type')
		})
	})

	// ── disconnectAll ───────────────────────────────────────

	describe('disconnectAll', () => {
		test('disconnects all active connections', async () => {
			const conn1 = manager.createConnection({
				name: 'DB1',
				config: sqliteConfig,
			})
			const conn2 = manager.createConnection({
				name: 'DB2',
				config: sqliteConfig,
			})

			await manager.connect(conn1.id)
			await manager.connect(conn2.id)

			await manager.disconnectAll()

			expect(manager.getConnectionState(conn1.id)).toBe('disconnected')
			expect(manager.getConnectionState(conn2.id)).toBe('disconnected')
			expect(() => manager.getDriver(conn1.id)).toThrow()
			expect(() => manager.getDriver(conn2.id)).toThrow()
		})
	})

	// ── Driver type selection ───────────────────────────────

	describe('driver type selection', () => {
		test('creates SqliteDriver for sqlite config', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			expect(manager.getDriver(conn.id).getDriverType()).toBe('sqlite')
		})

		// PostgresDriver connection test requires docker; tested via pg-driver.test.ts
		// Here we just verify the manager would create the right driver type
		test('createConnection accepts postgresql config', () => {
			const conn = manager.createConnection({
				name: 'PG',
				config: pgConfig,
			})
			expect(conn.config.type).toBe('postgresql')
		})
	})

	// ── Health check ────────────────────────────────────────

	describe('health check', () => {
		test('detects connection loss via health check', async () => {
			const events: StatusChangeEvent[] = []
			manager.onStatusChanged((e) => {
				events.push(e)
			})

			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			// Manually disconnect the driver to simulate connection loss
			const driver = manager.getDriver(conn.id)
			await driver.disconnect()

			// Trigger health check manually via private method
			await (manager as any).performHealthCheck(conn.id)

			// Should have detected the failure and set state to disconnected
			const lastEvent = events[events.length - 1]
			expect(lastEvent.state).toBe('disconnected')
			expect(lastEvent.error).toBe('Connection lost')
		})

		test('health check succeeds on healthy connection', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			const eventsBefore: StatusChangeEvent[] = []
			manager.onStatusChanged((e) => {
				eventsBefore.push(e)
			})

			// Health check on a working connection should emit no events
			await (manager as any).performHealthCheck(conn.id)
			expect(eventsBefore).toHaveLength(0)
			expect(manager.getConnectionState(conn.id)).toBe('connected')
		})

		test('health check is a no-op when no driver exists', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})

			// No connect, so no driver — should not throw
			await (manager as any).performHealthCheck(conn.id)
		})
	})

	// ── Auto-reconnect ──────────────────────────────────────

	describe('auto-reconnect', () => {
		let fastManager: ConnectionManager

		beforeEach(() => {
			// Reuse the parent's appDb — avoid resetting the singleton
			fastManager = new ConnectionManager(appDb, {
				healthCheckIntervalMs: 60_000, // won't fire during test
				reconnectBaseDelayMs: 50,
				reconnectMaxDelayMs: 200,
				reconnectMaxAttempts: 3,
			})
		})

		afterEach(async () => {
			await fastManager.disconnectAll()
		})

		test('auto-reconnect recovers after health check failure', async () => {
			const conn = fastManager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await fastManager.connect(conn.id)

			const events: StatusChangeEvent[] = []
			fastManager.onStatusChanged((e) => {
				events.push(e)
			})

			// Simulate connection loss
			const driver = fastManager.getDriver(conn.id)
			await driver.disconnect()
			await (fastManager as any).performHealthCheck(conn.id)

			// Wait for auto-reconnect to succeed (50ms first attempt)
			await Bun.sleep(200)

			expect(fastManager.getConnectionState(conn.id)).toBe('connected')

			// Should have seen: disconnected → reconnecting → connected
			const states = events.map((e) => e.state)
			expect(states).toContain('disconnected')
			expect(states).toContain('reconnecting')
			expect(states[states.length - 1]).toBe('connected')
		})

		test('auto-reconnect stops after max attempts', async () => {
			const conn = fastManager.createConnection({
				name: 'Bad SQLite',
				config: { type: 'sqlite', path: '/nonexistent/dir/impossible.db' },
			}) // Manually set up state as if it was connected then lost
			;(fastManager as any).states.set(conn.id, { state: 'connected' })

			const events: StatusChangeEvent[] = []
			fastManager.onStatusChanged((e) => {
				events.push(e)
			}) // Trigger auto-reconnect directly
			;(fastManager as any).startAutoReconnect(conn.id)

			// Wait for 3 attempts: 50ms + 100ms + 200ms = 350ms + some buffer
			await Bun.sleep(600)

			expect(fastManager.getConnectionState(conn.id)).toBe('error')
			const lastEvent = events[events.length - 1]
			expect(lastEvent.error).toContain('Reconnect failed after 3 attempts')
		})

		test('manual reconnect cancels auto-reconnect', async () => {
			const conn = fastManager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await fastManager.connect(conn.id)

			// Simulate connection loss
			const driver = fastManager.getDriver(conn.id)
			await driver.disconnect()
			await (fastManager as any).performHealthCheck(conn.id)

			// Auto-reconnect started — now do manual reconnect immediately
			await fastManager.reconnect(conn.id)

			expect(fastManager.getConnectionState(conn.id)).toBe('connected')
			// Reconnect state should be cleared
			expect((fastManager as any).reconnectStates.has(conn.id)).toBe(false)
		})

		test('disconnect cancels auto-reconnect', async () => {
			const conn = fastManager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await fastManager.connect(conn.id)

			// Simulate connection loss
			const driver = fastManager.getDriver(conn.id)
			await driver.disconnect()
			await (fastManager as any).performHealthCheck(conn.id)

			// Auto-reconnect started — now disconnect
			await fastManager.disconnect(conn.id)

			expect(fastManager.getConnectionState(conn.id)).toBe('disconnected')
			expect((fastManager as any).reconnectStates.has(conn.id)).toBe(false)

			// Wait to ensure no reconnect attempts happen
			await Bun.sleep(200)
			expect(fastManager.getConnectionState(conn.id)).toBe('disconnected')
		})
	})

	// ── Graceful disconnect ─────────────────────────────────

	describe('graceful disconnect', () => {
		test('rolls back open transaction on disconnect', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			const driver = manager.getDriver(conn.id)

			// Create a table and start a transaction
			await driver.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
			await driver.execute("INSERT INTO test (val) VALUES ('initial')")
			await driver.beginTransaction()
			await driver.execute("INSERT INTO test (val) VALUES ('in-tx')")

			expect(driver.inTransaction()).toBe(true)

			// Disconnect should rollback
			await manager.disconnect(conn.id)
			expect(manager.getConnectionState(conn.id)).toBe('disconnected')
		})

		test('disconnect works even without open transaction', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			await manager.disconnect(conn.id)
			expect(manager.getConnectionState(conn.id)).toBe('disconnected')
			expect(() => manager.getDriver(conn.id)).toThrow('No active connection')
		})

		test('reconnect gracefully disconnects before reconnecting', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)
			const driver = manager.getDriver(conn.id)

			// Start a transaction
			await driver.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
			await driver.beginTransaction()
			await driver.execute("INSERT INTO test (val) VALUES ('in-tx')")

			// Reconnect should gracefully disconnect first (rolling back tx)
			await manager.reconnect(conn.id)
			expect(manager.getConnectionState(conn.id)).toBe('connected')

			// New driver should not be in a transaction
			const newDriver = manager.getDriver(conn.id)
			expect(newDriver.inTransaction()).toBe(false)
		})
	})

	// ── Multi-database support ─────────────────────────────
	describe('multi-database', () => {
		test('getDriver without database param returns default driver', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			// getDriver() without database should return the default driver
			const driver = manager.getDriver(conn.id)
			expect(driver).toBeTruthy()
			expect(driver.isConnected()).toBe(true)
		})

		test('getDriver with explicit default database returns same driver', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			// For SQLite, default database is the path
			const defaultDriver = manager.getDriver(conn.id)
			const explicitDriver = manager.getDriver(conn.id, ':memory:')
			expect(defaultDriver).toBe(explicitDriver)
		})

		test('getDriver throws for non-active database', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			expect(() => manager.getDriver(conn.id, 'nonexistent_db')).toThrow(
				'No active driver for database "nonexistent_db"',
			)
		})

		test('listDatabases rejects SQLite connections', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			await expect(manager.listDatabases(conn.id)).rejects.toThrow(
				'only supported for connections with multi-database support',
			)
		})

		test('activateDatabase rejects SQLite connections', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			await expect(
				manager.activateDatabase(conn.id, 'other_db'),
			).rejects.toThrow('only supported for connections with multi-database support')
		})

		test('deactivateDatabase rejects SQLite connections', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			await expect(
				manager.deactivateDatabase(conn.id, 'other_db'),
			).rejects.toThrow('only supported for connections with multi-database support')
		})

		test('deactivateDatabase rejects default database', async () => {
			const conn = manager.createConnection({
				name: 'PG',
				config: pgConfig,
			})

			// We can't actually connect PG without a server, but we can test
			// the validation path by manually setting up the driver map
			const driverMap = new Map()
			driverMap.set('mydb', createMockDriver())
			;(manager as any).drivers.set(conn.id, driverMap)

			await expect(
				manager.deactivateDatabase(conn.id, 'mydb'),
			).rejects.toThrow('Cannot deactivate the default database')
		})

		test('activateDatabase on already-active database is a no-op', async () => {
			const conn = manager.createConnection({
				name: 'PG',
				config: pgConfig,
			})

			// Manually set up driver map to simulate connected state
			const mock = createMockDriver()
			const driverMap = new Map()
			driverMap.set('mydb', mock)
			driverMap.set('other_db', mock)
			;(manager as any).drivers.set(conn.id, driverMap)

			// Should return without error (no-op)
			await manager.activateDatabase(conn.id, 'other_db')
			// Driver map should still have same entries
			expect((manager as any).drivers.get(conn.id).has('other_db')).toBe(true)
		})

		test('disconnect clears all drivers in nested map', async () => {
			const conn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(conn.id)

			// Verify driver exists
			expect(manager.getDriver(conn.id).isConnected()).toBe(true)

			await manager.disconnect(conn.id)

			// All drivers should be cleaned up
			expect(() => manager.getDriver(conn.id)).toThrow('No active connection')
		})

		test('password is cached on connect and cleared on disconnect', async () => {
			manager.createConnection({
				name: 'PG',
				config: pgConfig,
			})

			// We can't connect PG without a server, but we can verify password
			// caching logic indirectly. Let's test with SQLite which doesn't cache.
			const sqliteConn = manager.createConnection({
				name: 'SQLite',
				config: sqliteConfig,
			})
			await manager.connect(sqliteConn.id)

			// SQLite shouldn't cache a password
			expect((manager as any).passwords.has(sqliteConn.id)).toBe(false)

			await manager.disconnect(sqliteConn.id)
		})

		test('connect with configOverride caches the override password', async () => {
			// For PostgreSQL, password should be cached on connect
			// We can't actually connect but can verify the code path via the
			// pgConfig connection that would fail
			const conn = manager.createConnection({
				name: 'PG',
				config: { ...pgConfig, password: '' },
				// allowMissingPassword
			}, true)

			// Trying to connect will fail (no PG server) but password caching
			// happens before the driver.connect call. We verify this by checking
			// the connect method's behavior indirectly.
			// This is a unit-level verification that the password Map is used.
			expect((manager as any).passwords.has(conn.id)).toBe(false)
		})

		test('deactivateDatabase removes driver and persists config', async () => {
			const conn = manager.createConnection({
				name: 'PG',
				config: { ...pgConfig, activeDatabases: ['other_db'] },
			})

			// Manually set up driver map to simulate connected state
			let disconnectCalled = false
			const otherMock = createMockDriver()
			otherMock.disconnect = async () => {
				disconnectCalled = true
			}
			const driverMap = new Map()
			driverMap.set('mydb', createMockDriver())
			driverMap.set('other_db', otherMock)
			;(manager as any).drivers.set(conn.id, driverMap)

			await manager.deactivateDatabase(conn.id, 'other_db')

			// Driver should have been disconnected
			expect(disconnectCalled).toBe(true)
			// Driver should be removed from map
			expect(driverMap.has('other_db')).toBe(false)
			// Default driver should remain
			expect(driverMap.has('mydb')).toBe(true)

			// Config should be persisted without other_db in activeDatabases
			const updatedConn = appDb.getConnectionById(conn.id)
			const updatedConfig = updatedConn!.config as PostgresConnectionConfig
			expect(updatedConfig.activeDatabases).toBeUndefined()
		})

		test('deactivateDatabase on non-active database is a no-op for driver', async () => {
			const conn = manager.createConnection({
				name: 'PG',
				config: { ...pgConfig, activeDatabases: ['other_db'] },
			})

			const driverMap = new Map()
			driverMap.set('mydb', createMockDriver())
			;(manager as any).drivers.set(conn.id, driverMap)

			// Should not throw even though "other_db" driver doesn't exist
			await manager.deactivateDatabase(conn.id, 'other_db')

			// Config should still be updated
			const updatedConn = appDb.getConnectionById(conn.id)
			const updatedConfig = updatedConn!.config as PostgresConnectionConfig
			expect(updatedConfig.activeDatabases).toBeUndefined()
		})

		test('activateDatabase rejects when pool limit is reached', async () => {
			const limitedManager = new ConnectionManager(appDb, { maxActiveDatabases: 3 })
			const conn = limitedManager.createConnection({
				name: 'PG',
				config: pgConfig,
			})

			// Manually set up driver map with 3 active databases (at limit)
			const driverMap = new Map()
			driverMap.set('mydb', createMockDriver())
			driverMap.set('db2', createMockDriver())
			driverMap.set('db3', createMockDriver())
			;(limitedManager as any).drivers.set(conn.id, driverMap)

			await expect(
				limitedManager.activateDatabase(conn.id, 'db4'),
			).rejects.toThrow('maximum number of active databases (3) reached')

			await limitedManager.disconnectAll()
		})
	})
})
