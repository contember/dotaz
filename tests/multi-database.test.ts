/**
 * Integration tests for multi-database support — exercises listDatabases /
 * activateDatabase / deactivateDatabase against real PG + MySQL servers.
 *
 * Each suite spins up a second database, activates it, runs queries through
 * the activated driver, then tears it down — verifying that driver-per-db
 * isolation actually works end-to-end.
 *
 * Run: docker compose up -d && bun test tests/multi-database.test.ts
 */
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { MysqlConnectionConfig, PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { seedMysql, seedPostgres } from './helpers'

const PG_SECONDARY = 'dotaz_test_secondary'
const MYSQL_SECONDARY = 'dotaz_test_secondary'

const pgConfig: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5488,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

const mysqlConfig: MysqlConnectionConfig = {
	type: 'mysql',
	host: 'localhost',
	port: 3388,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

let manager: ConnectionManager
let appDb: AppDatabase

beforeAll(async () => {
	await seedPostgres()
	await seedMysql()

	const { SQL } = await import('bun')

	// Create a secondary PG database (drop+create is idempotent across runs).
	const pgRoot = new SQL({ url: 'postgres://dotaz:dotaz@localhost:5488/postgres' })
	await pgRoot.unsafe(`DROP DATABASE IF EXISTS ${PG_SECONDARY}`)
	await pgRoot.unsafe(`CREATE DATABASE ${PG_SECONDARY}`)
	await pgRoot.close()

	// Create a secondary MySQL database — the dotaz user lacks CREATE DATABASE
	// on *.*, so we connect as root (MARIADB_ROOT_PASSWORD=dotaz from compose).
	const mysqlRoot = new SQL({ url: 'mysql://root:dotaz@localhost:3388/mysql' })
	await mysqlRoot.unsafe(`DROP DATABASE IF EXISTS ${MYSQL_SECONDARY}`)
	await mysqlRoot.unsafe(`CREATE DATABASE ${MYSQL_SECONDARY}`)
	await mysqlRoot.unsafe(`GRANT ALL PRIVILEGES ON ${MYSQL_SECONDARY}.* TO 'dotaz'@'%'`)
	await mysqlRoot.unsafe(`FLUSH PRIVILEGES`)
	await mysqlRoot.close()

	AppDatabase.resetInstance()
	appDb = AppDatabase.getInstance(':memory:')
	manager = new ConnectionManager(appDb)
}, 30_000)

afterAll(async () => {
	await manager.disconnectAll()
	AppDatabase.resetInstance()

	const { SQL } = await import('bun')
	const pgRoot = new SQL({ url: 'postgres://dotaz:dotaz@localhost:5488/postgres' })
	await pgRoot.unsafe(`DROP DATABASE IF EXISTS ${PG_SECONDARY}`)
	await pgRoot.close()

	const mysqlRoot = new SQL({ url: 'mysql://root:dotaz@localhost:3388/mysql' })
	await mysqlRoot.unsafe(`DROP DATABASE IF EXISTS ${MYSQL_SECONDARY}`)
	await mysqlRoot.close()
})

describe('multi-database — PostgreSQL', () => {
	test('listDatabases reports default db as active and includes the secondary', async () => {
		const conn = manager.createConnection({ name: 'PG Multi', config: pgConfig })
		await manager.connect(conn.id)

		const dbs = await manager.listDatabases(conn.id)
		const names = dbs.map((d) => d.name)

		expect(names).toContain('dotaz_test')
		expect(names).toContain(PG_SECONDARY)
		expect(names).not.toContain('template0')
		expect(names).not.toContain('template1')

		const defaultEntry = dbs.find((d) => d.name === 'dotaz_test')!
		expect(defaultEntry.isDefault).toBe(true)
		expect(defaultEntry.isActive).toBe(true)

		const secondaryEntry = dbs.find((d) => d.name === PG_SECONDARY)!
		expect(secondaryEntry.isDefault).toBe(false)
		expect(secondaryEntry.isActive).toBe(false)

		await manager.deleteConnection(conn.id)
	})

	test('activateDatabase creates a separate driver and deactivate tears it down', async () => {
		const conn = manager.createConnection({ name: 'PG Activate', config: pgConfig })
		await manager.connect(conn.id)

		await manager.activateDatabase(conn.id, PG_SECONDARY)

		// Both drivers should exist
		expect(manager.getActiveDatabases(conn.id)).toEqual(
			expect.arrayContaining(['dotaz_test', PG_SECONDARY]),
		)

		// Drivers must be distinct instances
		const defaultDriver = manager.getDriver(conn.id, 'dotaz_test')
		const secondaryDriver = manager.getDriver(conn.id, PG_SECONDARY)
		expect(defaultDriver).not.toBe(secondaryDriver)

		// Run a real query through the activated driver against an empty db
		const result = await secondaryDriver.execute('SELECT current_database() AS db')
		expect(result.rows[0]?.db).toBe(PG_SECONDARY)

		// Persisted to config
		const persisted = appDb.getConnectionById(conn.id)!.config as PostgresConnectionConfig
		expect(persisted.activeDatabases).toContain(PG_SECONDARY)

		// Deactivate releases the driver and cleans up config
		await manager.deactivateDatabase(conn.id, PG_SECONDARY)
		expect(manager.getActiveDatabases(conn.id)).toEqual(['dotaz_test'])
		expect(() => manager.getDriver(conn.id, PG_SECONDARY)).toThrow(
			'No active driver',
		)

		const after = appDb.getConnectionById(conn.id)!.config as PostgresConnectionConfig
		expect(after.activeDatabases).toBeUndefined()

		await manager.deleteConnection(conn.id)
	})

	test('listDatabases reflects activation state', async () => {
		const conn = manager.createConnection({ name: 'PG State', config: pgConfig })
		await manager.connect(conn.id)
		await manager.activateDatabase(conn.id, PG_SECONDARY)

		const dbs = await manager.listDatabases(conn.id)
		const secondaryEntry = dbs.find((d) => d.name === PG_SECONDARY)!
		expect(secondaryEntry.isActive).toBe(true)

		await manager.deleteConnection(conn.id)
	})

	test('persisted activeDatabases are restored on reconnect', async () => {
		const conn = manager.createConnection({
			name: 'PG Persist',
			config: { ...pgConfig, activeDatabases: [PG_SECONDARY] },
		})
		await manager.connect(conn.id)

		// Both drivers came up from the persisted config
		expect(manager.getActiveDatabases(conn.id)).toEqual(
			expect.arrayContaining(['dotaz_test', PG_SECONDARY]),
		)

		await manager.deleteConnection(conn.id)
	})
})

describe('multi-database — MySQL', () => {
	test('listDatabases excludes system schemas and reports active state', async () => {
		const conn = manager.createConnection({ name: 'MySQL Multi', config: mysqlConfig })
		await manager.connect(conn.id)

		const dbs = await manager.listDatabases(conn.id)
		const names = dbs.map((d) => d.name)

		expect(names).toContain('dotaz_test')
		expect(names).toContain(MYSQL_SECONDARY)
		expect(names).not.toContain('mysql')
		expect(names).not.toContain('information_schema')
		expect(names).not.toContain('performance_schema')
		expect(names).not.toContain('sys')

		expect(dbs.find((d) => d.name === 'dotaz_test')?.isDefault).toBe(true)
		expect(dbs.find((d) => d.name === 'dotaz_test')?.isActive).toBe(true)
		expect(dbs.find((d) => d.name === MYSQL_SECONDARY)?.isActive).toBe(false)

		await manager.deleteConnection(conn.id)
	})

	test('activateDatabase creates a separate MySQL driver and deactivate tears it down', async () => {
		const conn = manager.createConnection({ name: 'MySQL Activate', config: mysqlConfig })
		await manager.connect(conn.id)

		await manager.activateDatabase(conn.id, MYSQL_SECONDARY)

		const defaultDriver = manager.getDriver(conn.id, 'dotaz_test')
		const secondaryDriver = manager.getDriver(conn.id, MYSQL_SECONDARY)
		expect(defaultDriver).not.toBe(secondaryDriver)

		const result = await secondaryDriver.execute('SELECT DATABASE() AS db')
		expect(result.rows[0]?.db).toBe(MYSQL_SECONDARY)

		const persisted = appDb.getConnectionById(conn.id)!.config as MysqlConnectionConfig
		expect(persisted.activeDatabases).toContain(MYSQL_SECONDARY)

		await manager.deactivateDatabase(conn.id, MYSQL_SECONDARY)
		expect(() => manager.getDriver(conn.id, MYSQL_SECONDARY)).toThrow(
			'No active driver',
		)

		const after = appDb.getConnectionById(conn.id)!.config as MysqlConnectionConfig
		expect(after.activeDatabases).toBeUndefined()

		await manager.deleteConnection(conn.id)
	})

	test('persisted activeDatabases are restored on reconnect', async () => {
		const conn = manager.createConnection({
			name: 'MySQL Persist',
			config: { ...mysqlConfig, activeDatabases: [MYSQL_SECONDARY] },
		})
		await manager.connect(conn.id)

		expect(manager.getActiveDatabases(conn.id)).toEqual(
			expect.arrayContaining(['dotaz_test', MYSQL_SECONDARY]),
		)

		await manager.deleteConnection(conn.id)
	})

	test('cannot deactivate the default MySQL database', async () => {
		const conn = manager.createConnection({ name: 'MySQL Default', config: mysqlConfig })
		await manager.connect(conn.id)

		await expect(manager.deactivateDatabase(conn.id, 'dotaz_test')).rejects.toThrow(
			'Cannot deactivate the default database',
		)

		await manager.deleteConnection(conn.id)
	})
})
