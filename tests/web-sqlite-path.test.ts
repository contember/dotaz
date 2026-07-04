// Web mode must not let a client open arbitrary SQLite files on the server's
// filesystem. When allowServerFileAccess is false, any CLIENT-supplied sqlite
// config (create/update/test/connect/listForConfig) must be rejected — while
// the server-managed DATABASE_URL connection (connect by id, no client config)
// keeps working. See BackendAdapter.rejectServerSqliteConfig.

import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { EncryptionService } from '@dotaz/backend-shared/services/encryption'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import type { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests'
const SERVER_FILE_ACCESS_ERROR = 'Server file access is not available in this runtime'

interface Harness {
	appDb: AppDatabase
	cm: ConnectionManager
	sessionManager: SessionManager
	handlers: ReturnType<typeof createHandlers>['handlers']
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
	while (cleanups.length > 0) {
		const cleanup = cleanups.pop()!
		await cleanup()
	}
})

/** Build handlers wired like a web session: encryption on, server file access off (default false here). */
function makeHarness(allowServerFileAccess: boolean): Harness {
	const appDb = AppDatabase.create(':memory:')
	const cm = new ConnectionManager(appDb)
	const queryExecutor = new QueryExecutor(cm, undefined, appDb)
	const encryption = new EncryptionService(ENCRYPTION_KEY)
	const { handlers, sessionManager } = createHandlers(cm, queryExecutor, appDb, undefined, {
		encryption,
		allowServerFileAccess,
	})
	cleanups.push(async () => {
		sessionManager.dispose()
		await cm.disconnectAll()
		appDb.close()
	})
	return { appDb, cm, sessionManager, handlers }
}

function sqliteConfig(path: string): SqliteConnectionConfig {
	return { type: 'sqlite', path }
}

describe('Web mode SQLite path guard (allowServerFileAccess: false)', () => {
	test('connections.create rejects a client sqlite server path', () => {
		const { handlers } = makeHarness(false)
		expect(() => handlers['connections.create']({ name: 'evil', config: sqliteConfig('/etc/hosts') }))
			.toThrow(SERVER_FILE_ACCESS_ERROR)
	})

	test('connections.update rejects a client sqlite server path', () => {
		const { handlers } = makeHarness(false)
		expect(() => handlers['connections.update']({ id: 'anything', name: 'evil', config: sqliteConfig('/etc/hosts') }))
			.toThrow(SERVER_FILE_ACCESS_ERROR)
	})

	test('connections.test rejects a client sqlite server path', async () => {
		const { handlers } = makeHarness(false)
		await expect(handlers['connections.test']({ config: sqliteConfig('/etc/hosts') }))
			.rejects.toThrow(SERVER_FILE_ACCESS_ERROR)
	})

	test('connections.connect rejects a client sqlite server path', async () => {
		const { handlers } = makeHarness(false)
		await expect(handlers['connections.connect']({ connectionId: 'attacker', config: sqliteConfig('/etc/hosts') }))
			.rejects.toThrow(SERVER_FILE_ACCESS_ERROR)
	})

	test('databases.listForConfig rejects a client sqlite server path', async () => {
		const { handlers } = makeHarness(false)
		await expect(handlers['databases.listForConfig']({ config: sqliteConfig('/etc/hosts') }))
			.rejects.toThrow(SERVER_FILE_ACCESS_ERROR)
	})

	test('the attacker config is never persisted after a rejected create', () => {
		const { handlers, appDb } = makeHarness(false)
		expect(() => handlers['connections.create']({ name: 'evil', config: sqliteConfig('/etc/hosts') }))
			.toThrow(SERVER_FILE_ACCESS_ERROR)
		expect(appDb.listConnections()).toHaveLength(0)
	})

	test('even :memory: is blocked as a client-supplied sqlite config', async () => {
		const { handlers } = makeHarness(false)
		await expect(handlers['connections.connect']({ connectionId: 'attacker', config: sqliteConfig(':memory:') }))
			.rejects.toThrow(SERVER_FILE_ACCESS_ERROR)
	})
})

describe('Server file access allowed (default: desktop/demo)', () => {
	test('connections.test with an in-memory sqlite config succeeds', async () => {
		const { handlers } = makeHarness(true)
		const result = await handlers['connections.test']({ config: sqliteConfig(':memory:') })
		expect(result.success).toBe(true)
	})

	test('create + connect a sqlite :memory: connection works', async () => {
		const { handlers, cm } = makeHarness(true)
		const conn = handlers['connections.create']({ name: 'mem', config: sqliteConfig(':memory:') })
		await handlers['connections.connect']({ connectionId: conn.id })
		expect(cm.getConnectionState(conn.id)).toBe('connected')
	})
})

describe('Server-managed env connection (connect by id, no client config)', () => {
	test('a pre-stored sqlite file connection is NOT rejected even with server file access off', async () => {
		const { handlers, appDb, cm } = makeHarness(false)

		// Simulate the DATABASE_URL=sqlite:/path connection created server-side.
		const dbFile = join(tmpdir(), `dotaz-env-${crypto.randomUUID()}.sqlite`)
		cleanups.push(() => {
			for (const suffix of ['', '-wal', '-shm']) {
				rmSync(dbFile + suffix, { force: true })
			}
		})
		const envId = 'env-connection'
		appDb.createConnectionWithId(envId, { name: 'DATABASE_URL', config: sqliteConfig(dbFile) })

		// Connect by id with NO client config — the guarded path must stay open.
		await handlers['connections.connect']({ connectionId: envId })
		expect(cm.getConnectionState(envId)).toBe('connected')

		const driver = cm.getDriver(envId)
		const result = await driver.execute('SELECT 1 AS one')
		expect(result.rows).toEqual([{ one: 1 }])
	})
})
