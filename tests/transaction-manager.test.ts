import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { TransactionManager } from '@dotaz/backend-shared/services/transaction-manager'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTestAppDb } from './helpers'

const sqliteConfig: SqliteConnectionConfig = {
	type: 'sqlite',
	path: ':memory:',
}

describe('TransactionManager', () => {
	let cm: ConnectionManager
	let txManager: TransactionManager
	let connectionId: string

	beforeEach(async () => {
		const appDb = createTestAppDb()
		cm = new ConnectionManager(appDb)
		txManager = new TransactionManager(cm)

		const conn = cm.createConnection({ name: 'Test', config: sqliteConfig })
		connectionId = conn.id
		await cm.connect(connectionId)
	})

	afterEach(async () => {
		await cm.disconnectAll()
	})

	test('isActive returns false when no transaction', () => {
		expect(txManager.isActive(connectionId)).toBe(false)
	})

	test('begin starts a transaction', async () => {
		await txManager.begin(connectionId)
		expect(txManager.isActive(connectionId)).toBe(true)
	})

	test('commit ends a transaction', async () => {
		await txManager.begin(connectionId)
		await txManager.commit(connectionId)
		expect(txManager.isActive(connectionId)).toBe(false)
	})

	test('rollback ends a transaction', async () => {
		await txManager.begin(connectionId)
		await txManager.rollback(connectionId)
		expect(txManager.isActive(connectionId)).toBe(false)
	})

	test('begin throws when transaction already active', async () => {
		await txManager.begin(connectionId)
		await expect(txManager.begin(connectionId)).rejects.toThrow(
			'Transaction already active',
		)
	})

	test('commit throws when no active transaction', async () => {
		await expect(txManager.commit(connectionId)).rejects.toThrow(
			'No active transaction to commit',
		)
	})

	test('rollback throws when no active transaction', async () => {
		await expect(txManager.rollback(connectionId)).rejects.toThrow(
			'No active transaction to rollback',
		)
	})

	test('isActive returns false for unknown connection', () => {
		expect(txManager.isActive('nonexistent')).toBe(false)
	})

	test('rollbackIfActive does nothing when no transaction', async () => {
		await txManager.rollbackIfActive(connectionId)
		expect(txManager.isActive(connectionId)).toBe(false)
	})

	test('rollbackIfActive rolls back active transaction', async () => {
		await txManager.begin(connectionId)
		await txManager.rollbackIfActive(connectionId)
		expect(txManager.isActive(connectionId)).toBe(false)
	})

	test('transaction changes are committed', async () => {
		const driver = cm.getDriver(connectionId)
		await driver.execute('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, val TEXT)', [])

		await txManager.begin(connectionId)
		await driver.execute("INSERT INTO tx_test (id, val) VALUES (1, 'hello')", [])
		await txManager.commit(connectionId)

		const result = await driver.execute('SELECT val FROM tx_test WHERE id = 1', [])
		expect(result.rows[0].val).toBe('hello')
	})

	test('transaction changes are rolled back', async () => {
		const driver = cm.getDriver(connectionId)
		await driver.execute('CREATE TABLE tx_test2 (id INTEGER PRIMARY KEY, val TEXT)', [])
		await driver.execute("INSERT INTO tx_test2 (id, val) VALUES (1, 'original')", [])

		await txManager.begin(connectionId)
		await driver.execute("UPDATE tx_test2 SET val = 'changed' WHERE id = 1", [])
		await txManager.rollback(connectionId)

		const result = await driver.execute('SELECT val FROM tx_test2 WHERE id = 1', [])
		expect(result.rows[0].val).toBe('original')
	})
})
