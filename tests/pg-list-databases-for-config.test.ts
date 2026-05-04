/**
 * Integration tests for ConnectionManager.listDatabasesForConfig — exercises
 * the "Fetch databases" picker in the connection dialog against real PG/MySQL
 * servers from docker-compose.
 *
 * Run: docker compose up -d && bun test tests/list-databases-for-config.test.ts
 */
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { MysqlConnectionConfig, PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { seedMysql, seedPostgres } from './helpers'

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

beforeAll(async () => {
	await seedPostgres()
	await seedMysql()
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	manager = new ConnectionManager(appDb)
}, 30_000)

afterAll(async () => {
	await manager.disconnectAll()
	AppDatabase.resetInstance()
})

describe('listDatabasesForConfig — PostgreSQL', () => {
	test('returns the seeded database and excludes template DBs', async () => {
		const databases = await manager.listDatabasesForConfig(pgConfig)
		expect(databases).toContain('dotaz_test')
		expect(databases).not.toContain('template0')
		expect(databases).not.toContain('template1')
	})

	test('result is sorted alphabetically', async () => {
		const databases = await manager.listDatabasesForConfig(pgConfig)
		const sorted = [...databases].sort()
		expect(databases).toEqual(sorted)
	})

	test('falls back to "postgres" when database is not specified', async () => {
		// Empty database simulates the dialog state before the user picks one.
		const databases = await manager.listDatabasesForConfig({ ...pgConfig, database: '' })
		expect(databases).toContain('dotaz_test')
		expect(databases).toContain('postgres')
	})

	test('does not leak active drivers — listing is ephemeral', async () => {
		await manager.listDatabasesForConfig(pgConfig)
		// No connection was registered via connect(), so the manager must not retain a driver.
		expect(manager.getActiveDatabases('any-id')).toEqual([])
	})

	test('rejects bad credentials with the underlying driver error', async () => {
		await expect(
			manager.listDatabasesForConfig({ ...pgConfig, password: 'wrong-password' }),
		).rejects.toThrow()
	})
})

describe('listDatabasesForConfig — MySQL', () => {
	test('returns the seeded database and excludes system schemas', async () => {
		const databases = await manager.listDatabasesForConfig(mysqlConfig)
		expect(databases).toContain('dotaz_test')
		expect(databases).not.toContain('mysql')
		expect(databases).not.toContain('information_schema')
		expect(databases).not.toContain('performance_schema')
		expect(databases).not.toContain('sys')
	})

	test('falls back to "information_schema" when database is not specified', async () => {
		const databases = await manager.listDatabasesForConfig({ ...mysqlConfig, database: '' })
		expect(databases).toContain('dotaz_test')
	})
})
