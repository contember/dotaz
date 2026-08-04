/**
 * Engine-enforced read-only sessions.
 *
 * SQLite needs a file-backed database: a read-only session gets its own `SQL`
 * handle with `PRAGMA query_only = ON`, and `:memory:` cannot be shared between
 * handles. PostgreSQL/MySQL coverage needs `docker compose up -d`.
 *
 * Run: bun test tests/readonly-session.test.ts
 */
import { MysqlDriver } from '@dotaz/backend-shared/drivers/mysql-driver'
import { PostgresDriver } from '@dotaz/backend-shared/drivers/postgres-driver'
import { SqliteDriver } from '@dotaz/backend-shared/drivers/sqlite-driver'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { MysqlConnectionConfig, PostgresConnectionConfig, SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseError } from '@dotaz/shared/types/errors'
import { SQL } from 'bun'
import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MYSQL_URL, PG_URL, seedMysql, seedPostgres, seedSqlite } from './helpers'

let dbPath: string
let config: SqliteConnectionConfig

/** First column value of the first row — PRAGMA result column names vary. */
function firstValue(rows: Record<string, unknown>[]): unknown {
	return rows.length > 0 ? Object.values(rows[0])[0] : undefined
}

function createTempDb(): string {
	const path = join(tmpdir(), `dotaz-readonly-${crypto.randomUUID()}.db`)
	const seed = new Database(path)
	seedSqlite(seed)
	seed.close()
	return path
}

function removeTempDb(path: string): void {
	for (const suffix of ['', '-wal', '-shm']) {
		rmSync(`${path}${suffix}`, { force: true })
	}
}

/** Register hooks giving each test in the enclosing describe a freshly seeded SQLite file. */
function useTempSqliteDb(): void {
	beforeEach(() => {
		dbPath = createTempDb()
		config = { type: 'sqlite', path: dbPath }
	})

	afterEach(() => {
		removeTempDb(dbPath)
	})
}

/** The docker-compose services are optional — skip their tests when they aren't up. */
async function isReachable(url: string): Promise<boolean> {
	try {
		const db = new SQL({ url })
		await db.unsafe('SELECT 1')
		await db.close()
		return true
	} catch {
		return false
	}
}

const pgReachable = await isReachable(PG_URL)
const mysqlReachable = await isReachable(MYSQL_URL)

describe('SqliteDriver read-only sessions', () => {
	useTempSqliteDb()

	let driver: SqliteDriver
	let readOnlyId: string
	let writableId: string

	beforeEach(async () => {
		driver = new SqliteDriver()
		await driver.connect(config)
		readOnlyId = crypto.randomUUID()
		writableId = crypto.randomUUID()
		await driver.reserveSession(readOnlyId, { readOnly: true })
		await driver.reserveSession(writableId)
	})

	afterEach(async () => {
		await driver.disconnect()
	})

	test('reports which sessions are read-only', () => {
		expect(driver.isSessionReadOnly(readOnlyId)).toBe(true)
		expect(driver.isSessionReadOnly(writableId)).toBe(false)
		expect(driver.getSessionIds()).toContain(readOnlyId)
	})

	test('query_only is on for the read-only session and nowhere else', async () => {
		expect(firstValue((await driver.execute('PRAGMA query_only', undefined, readOnlyId)).rows)).toBe(1)
		expect(firstValue((await driver.execute('PRAGMA query_only', undefined, writableId)).rows)).toBe(0)
		expect(firstValue((await driver.execute('PRAGMA query_only')).rows)).toBe(0)
	})

	test('the read-only session still reads', async () => {
		const result = await driver.execute('SELECT name FROM users ORDER BY id', undefined, readOnlyId)
		expect(result.rows).toHaveLength(3)
		expect(result.rows[0].name).toBe('Alice')
	})

	test('the read-only session still iterates', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT id FROM users ORDER BY id', undefined, 2, undefined, readOnlyId)) {
			batches.push(batch)
		}
		expect(batches.flat()).toHaveLength(3)
	})

	test('INSERT is rejected by the engine', async () => {
		const promise = driver.execute("INSERT INTO users (name, email) VALUES ('Dana', 'dana@example.com')", undefined, readOnlyId)
		await expect(promise).rejects.toThrow(/readonly/i)
	})

	test('UPDATE is rejected by the engine', async () => {
		const promise = driver.execute("UPDATE users SET name = 'Nope'", undefined, readOnlyId)
		await expect(promise).rejects.toThrow(/readonly/i)
	})

	test('DELETE is rejected by the engine', async () => {
		const promise = driver.execute('DELETE FROM users', undefined, readOnlyId)
		await expect(promise).rejects.toThrow(/readonly/i)
	})

	test('DDL is rejected by the engine', async () => {
		const promise = driver.execute('CREATE TABLE sneaky (id INTEGER)', undefined, readOnlyId)
		await expect(promise).rejects.toThrow(/readonly/i)
	})

	test('a write disguised as a PRAGMA is still rejected by the engine', async () => {
		// classifyStatement() calls this `unknown`, so only the engine can stop it
		const promise = driver.execute('PRAGMA user_version = 4', undefined, readOnlyId)
		await expect(promise).rejects.toThrow(/readonly/i)
	})

	test('a write inside an explicit transaction is still rejected', async () => {
		await driver.beginTransaction(readOnlyId)
		expect(driver.inTransaction(readOnlyId)).toBe(true)
		try {
			const promise = driver.execute('DELETE FROM posts', undefined, readOnlyId)
			await expect(promise).rejects.toThrow(/readonly/i)
		} finally {
			await driver.rollback(readOnlyId)
		}
		expect(driver.inTransaction(readOnlyId)).toBe(false)
	})

	test('a normal session on the same connection still writes', async () => {
		const inserted = await driver.execute(
			"INSERT INTO users (name, email) VALUES ('Dana', 'dana@example.com')",
			undefined,
			writableId,
		)
		expect(inserted.affectedRows).toBe(1)

		const pooled = await driver.execute("UPDATE users SET age = 40 WHERE name = 'Dana'")
		expect(pooled.affectedRows).toBe(1)

		// The read-only session sees the committed write on the same file
		const seen = await driver.execute("SELECT age FROM users WHERE name = 'Dana'", undefined, readOnlyId)
		expect(seen.rows[0].age).toBe(40)
	})

	test("a read-only session's transaction does not block the shared connection", async () => {
		await driver.beginTransaction(readOnlyId)
		try {
			const result = await driver.execute("INSERT INTO users (name, email) VALUES ('Eve', 'eve@example.com')", undefined, writableId)
			expect(result.affectedRows).toBe(1)
		} finally {
			await driver.rollback(readOnlyId)
		}
	})

	test('the dedicated handle is listed and closed on release', async () => {
		const before = driver.listConnectionHandles().filter((h) => h.sessionId === readOnlyId)
		expect(before).toHaveLength(1)
		expect(before[0].role).toBe('session')

		await driver.releaseSession(readOnlyId)

		expect(driver.isSessionReadOnly(readOnlyId)).toBe(false)
		expect(driver.getSessionIds()).not.toContain(readOnlyId)
		expect(driver.listConnectionHandles().filter((h) => h.sessionId === readOnlyId)).toHaveLength(0)
	})
})

describe('SqliteDriver read-only sessions — unsupported databases', () => {
	test('an in-memory database cannot back a read-only session', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })
		try {
			await expect(driver.reserveSession(crypto.randomUUID(), { readOnly: true })).rejects.toThrow(/file-backed/i)
			// A failed reserve must not leave the session registered
			expect(driver.getSessionIds()).toHaveLength(0)
		} finally {
			await driver.disconnect()
		}
	})
})

describe('SqliteDriver read-only sessions — initSql', () => {
	useTempSqliteDb()

	test('setup SQL is applied to the dedicated handle', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ ...config, initSql: 'PRAGMA busy_timeout = 7000' })
		const sessionId = crypto.randomUUID()
		await driver.reserveSession(sessionId, { readOnly: true })
		try {
			expect(firstValue((await driver.execute('PRAGMA busy_timeout', undefined, sessionId)).rows)).toBe(7000)
			expect(firstValue((await driver.execute('PRAGMA query_only', undefined, sessionId)).rows)).toBe(1)
		} finally {
			await driver.disconnect()
		}
	})
})

describe('SessionManager read-only sessions', () => {
	useTempSqliteDb()

	let appDb: AppDatabase
	let cm: ConnectionManager
	let sm: SessionManager
	let connectionId: string

	beforeEach(async () => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
		cm = new ConnectionManager(appDb)
		sm = new SessionManager(cm, appDb)
		connectionId = cm.createConnection({ name: 'Test', config }).id
		await cm.connect(connectionId)
	})

	afterEach(async () => {
		sm.dispose()
		await cm.disconnectAll()
		AppDatabase.resetInstance()
	})

	test('createSession marks the session read-only on the driver', async () => {
		const session = await sm.createSession(connectionId, undefined, { readOnly: true, label: 'Agent' })
		expect(session.readOnly).toBe(true)
		expect(session.label).toBe('Agent')
		expect(cm.getDriver(connectionId).isSessionReadOnly(session.sessionId)).toBe(true)
	})

	test('existing two-argument callers stay writable', async () => {
		const session = await sm.createSession(connectionId)
		expect(session.readOnly).toBeFalsy()
		expect(session.label).toBe('Session 1')
		expect(cm.getDriver(connectionId).isSessionReadOnly(session.sessionId)).toBe(false)
	})

	test('listSessions and getSession report the read-only flag', async () => {
		const session = await sm.createSession(connectionId, undefined, { readOnly: true })
		expect(sm.getSession(session.sessionId)?.readOnly).toBe(true)
		expect(sm.listSessions(connectionId)[0].readOnly).toBe(true)
	})

	test('restoration after reconnect keeps the session read-only and labelled', async () => {
		await sm.createSession(connectionId, undefined, { readOnly: true, label: 'Agent CLI' })
		await sm.createSession(connectionId)

		sm.handleConnectionLost(connectionId)
		const restored = await sm.handleConnectionRestored(connectionId)

		expect(restored).toHaveLength(2)
		const agent = restored.find((s) => s.label === 'Agent CLI')
		expect(agent).toBeDefined()
		expect(agent!.readOnly).toBe(true)
		expect(cm.getDriver(connectionId).isSessionReadOnly(agent!.sessionId)).toBe(true)

		const normal = restored.find((s) => s.label === 'Session 2')
		expect(normal).toBeDefined()
		expect(cm.getDriver(connectionId).isSessionReadOnly(normal!.sessionId)).toBe(false)
	})
})

describe('QueryExecutor read-only guard', () => {
	useTempSqliteDb()

	let appDb: AppDatabase
	let cm: ConnectionManager
	let sm: SessionManager
	let qe: QueryExecutor
	let connectionId: string
	let readOnlySessionId: string
	let writableSessionId: string

	beforeEach(async () => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
		cm = new ConnectionManager(appDb)
		sm = new SessionManager(cm, appDb)
		qe = new QueryExecutor(cm)
		connectionId = cm.createConnection({ name: 'Test', config }).id
		await cm.connect(connectionId)
		readOnlySessionId = (await sm.createSession(connectionId, undefined, { readOnly: true })).sessionId
		writableSessionId = (await sm.createSession(connectionId)).sessionId
	})

	afterEach(async () => {
		sm.dispose()
		await cm.disconnectAll()
		AppDatabase.resetInstance()
	})

	test('rejects a write before it reaches the driver', async () => {
		const promise = qe.executeQuery(
			connectionId,
			"INSERT INTO users (name, email) VALUES ('Dana', 'dana@example.com')",
			undefined,
			undefined,
			undefined,
			undefined,
			readOnlySessionId,
		)
		await expect(promise).rejects.toThrow(DatabaseError)
		await promise.catch((err: unknown) => {
			expect(err).toBeInstanceOf(DatabaseError)
			expect((err as DatabaseError).code).toBe('READ_ONLY_SESSION')
			expect((err as DatabaseError).message).toContain('dotaz propose')
		})
	})

	test('rejects a data-modifying CTE', async () => {
		const promise = qe.executeQuery(
			connectionId,
			'WITH t AS (SELECT 1 AS n) DELETE FROM users WHERE id IN (SELECT n FROM t)',
			undefined,
			undefined,
			undefined,
			undefined,
			readOnlySessionId,
		)
		await expect(promise).rejects.toThrow(/read-only/i)
	})

	test('rejects a batch where only one statement writes', async () => {
		const promise = qe.executeQuery(
			connectionId,
			'SELECT 1; DELETE FROM users;',
			undefined,
			undefined,
			undefined,
			undefined,
			readOnlySessionId,
		)
		await expect(promise).rejects.toThrow(/read-only/i)
	})

	test('fails closed on a statement it cannot classify', async () => {
		const promise = qe.executeQuery(connectionId, 'PRAGMA user_version = 4', undefined, undefined, undefined, undefined, readOnlySessionId)
		await expect(promise).rejects.toThrow(/read-only/i)
	})

	test('allows reads on the read-only session', async () => {
		const results = await qe.executeQuery(
			connectionId,
			'SELECT name FROM users ORDER BY id',
			undefined,
			undefined,
			undefined,
			undefined,
			readOnlySessionId,
		)
		expect(results).toHaveLength(1)
		expect(results[0].error).toBeUndefined()
		expect(results[0].rows).toHaveLength(3)
	})

	test('rejects EXPLAIN ANALYZE of a write but allows plain EXPLAIN', async () => {
		const analyze = qe.explainQuery(connectionId, 'DELETE FROM users', true, undefined, readOnlySessionId)
		await expect(analyze).rejects.toThrow(/read-only/i)

		const plain = await qe.explainQuery(connectionId, 'SELECT * FROM users', false, undefined, readOnlySessionId)
		expect(plain.error).toBeUndefined()
	})

	test('leaves normal sessions alone', async () => {
		const results = await qe.executeQuery(
			connectionId,
			"INSERT INTO users (name, email) VALUES ('Dana', 'dana@example.com')",
			undefined,
			undefined,
			undefined,
			undefined,
			writableSessionId,
		)
		expect(results[0].error).toBeUndefined()
		expect(results[0].affectedRows).toBe(1)
	})

	test('leaves sessionless (pool) execution alone', async () => {
		const results = await qe.executeQuery(connectionId, "UPDATE users SET age = 41 WHERE name = 'Alice'")
		expect(results[0].error).toBeUndefined()
		expect(results[0].affectedRows).toBe(1)
	})
})

// Requires `docker compose up -d` — skipped when the container isn't reachable.
describe.skipIf(!pgReachable)('PostgresDriver read-only sessions', () => {
	const pgConfig: PostgresConnectionConfig = {
		type: 'postgresql',
		host: 'localhost',
		port: 5488,
		database: 'dotaz_test',
		user: 'dotaz',
		password: 'dotaz',
	}

	let driver: PostgresDriver
	let readOnlyId: string
	let writableId: string

	beforeAll(async () => {
		await seedPostgres()
		driver = new PostgresDriver()
		await driver.connect(pgConfig)
	}, 30_000)

	afterAll(async () => {
		if (driver.isConnected()) await driver.disconnect()
	})

	beforeEach(async () => {
		readOnlyId = crypto.randomUUID()
		writableId = crypto.randomUUID()
		await driver.reserveSession(readOnlyId, { readOnly: true })
		await driver.reserveSession(writableId)
	})

	afterEach(async () => {
		await driver.releaseSession(readOnlyId)
		await driver.releaseSession(writableId)
	})

	test('the session connection reports read-only, others do not', async () => {
		expect(driver.isSessionReadOnly(readOnlyId)).toBe(true)
		expect(driver.isSessionReadOnly(writableId)).toBe(false)
		expect(firstValue((await driver.execute('SHOW transaction_read_only', undefined, readOnlyId)).rows)).toBe('on')
		expect(firstValue((await driver.execute('SHOW transaction_read_only', undefined, writableId)).rows)).toBe('off')
	})

	test('writes and DDL are rejected by the engine', async () => {
		const statements = [
			"INSERT INTO test_schema.users (name, email) VALUES ('Dana', 'dana@example.com')",
			"UPDATE test_schema.users SET name = 'Nope'",
			'DELETE FROM test_schema.users',
			'CREATE TABLE test_schema.sneaky (id integer)',
		]
		for (const sql of statements) {
			await expect(driver.execute(sql, undefined, readOnlyId)).rejects.toThrow(/read-only transaction/i)
		}
	})

	test('a write hidden behind a read (nextval) is rejected by the engine', async () => {
		// classifyStatement() calls this a read — only the engine can stop it
		await expect(driver.execute("SELECT nextval('test_schema.users_id_seq')", undefined, readOnlyId))
			.rejects.toThrow(/read-only transaction/i)
	})

	test('a transaction started later on the session is read-only too', async () => {
		await driver.beginTransaction(readOnlyId)
		try {
			expect(driver.inTransaction(readOnlyId)).toBe(true)
			await expect(driver.execute("INSERT INTO test_schema.users (name, email) VALUES ('Eve', 'eve@example.com')", undefined, readOnlyId))
				.rejects.toThrow(/read-only transaction/i)
		} finally {
			await driver.rollback(readOnlyId)
		}
	})

	test('the read-only session still reads', async () => {
		const result = await driver.execute('SELECT count(*)::int AS n FROM test_schema.users', undefined, readOnlyId)
		expect(Number(result.rows[0].n)).toBeGreaterThan(0)
	})

	test('a normal session on the same connection still writes', async () => {
		const result = await driver.execute(
			"INSERT INTO test_schema.users (name, email) VALUES ('Frank', 'frank@example.com')",
			undefined,
			writableId,
		)
		expect(result.affectedRows).toBe(1)
	})
})

// Requires `docker compose up -d` — skipped when the container isn't reachable.
describe.skipIf(!mysqlReachable)('MysqlDriver read-only sessions', () => {
	const mysqlConfig: MysqlConnectionConfig = {
		type: 'mysql',
		host: 'localhost',
		port: 3388,
		database: 'dotaz_test',
		user: 'dotaz',
		password: 'dotaz',
	}

	let driver: MysqlDriver
	let readOnlyId: string
	let writableId: string

	beforeAll(async () => {
		await seedMysql()
		driver = new MysqlDriver()
		await driver.connect(mysqlConfig)
	}, 30_000)

	afterAll(async () => {
		if (driver.isConnected()) await driver.disconnect()
	})

	beforeEach(async () => {
		readOnlyId = crypto.randomUUID()
		writableId = crypto.randomUUID()
		await driver.reserveSession(readOnlyId, { readOnly: true })
		await driver.reserveSession(writableId)
	})

	afterEach(async () => {
		await driver.releaseSession(readOnlyId)
		await driver.releaseSession(writableId)
	})

	test('the session connection reports read-only, others do not', async () => {
		expect(driver.isSessionReadOnly(readOnlyId)).toBe(true)
		expect(driver.isSessionReadOnly(writableId)).toBe(false)
		expect(Number(firstValue((await driver.execute('SELECT @@session.transaction_read_only AS v', undefined, readOnlyId)).rows))).toBe(1)
		expect(Number(firstValue((await driver.execute('SELECT @@session.transaction_read_only AS v', undefined, writableId)).rows))).toBe(0)
	})

	test('writes and DDL are rejected by the engine', async () => {
		const statements = [
			"INSERT INTO users (name, email) VALUES ('Dana', 'dana@example.com')",
			"UPDATE users SET name = 'Nope'",
			'DELETE FROM users',
			'CREATE TABLE sneaky (id int)',
		]
		for (const sql of statements) {
			await expect(driver.execute(sql, undefined, readOnlyId)).rejects.toThrow(/read only transaction/i)
		}
	})

	test('a transaction started later on the session is read-only too', async () => {
		await driver.beginTransaction(readOnlyId)
		try {
			expect(driver.inTransaction(readOnlyId)).toBe(true)
			await expect(driver.execute("INSERT INTO users (name, email) VALUES ('Eve', 'eve@example.com')", undefined, readOnlyId))
				.rejects.toThrow(/read only transaction/i)
		} finally {
			await driver.rollback(readOnlyId)
		}
	})

	test('the read-only session still reads', async () => {
		const result = await driver.execute('SELECT count(*) AS n FROM users', undefined, readOnlyId)
		expect(Number(result.rows[0].n)).toBeGreaterThan(0)
	})

	test('a normal session on the same connection still writes', async () => {
		const result = await driver.execute("INSERT INTO users (name, email) VALUES ('Frank', 'frank@example.com')", undefined, writableId)
		expect(result.affectedRows).toBe(1)
	})
})
