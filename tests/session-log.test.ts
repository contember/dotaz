import { beforeEach, describe, expect, test } from 'bun:test'
import { SessionLog } from '../src/backend-shared/services/query-executor'

describe('SessionLog', () => {
	let log: SessionLog

	beforeEach(() => {
		log = new SessionLog()
	})

	test('add and retrieve entries', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1)
		log.add('conn1', 'SELECT 2', 'error', 5, 0, 'syntax error')

		const entries = log.getEntries('conn1')
		expect(entries).toHaveLength(2)
		expect(entries[0].sql).toBe('SELECT 1')
		expect(entries[0].status).toBe('success')
		expect(entries[0].durationMs).toBe(10)
		expect(entries[0].rowCount).toBe(1)
		expect(entries[1].sql).toBe('SELECT 2')
		expect(entries[1].status).toBe('error')
		expect(entries[1].errorMessage).toBe('syntax error')
	})

	test('entries are isolated per connection', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1)
		log.add('conn2', 'SELECT 2', 'success', 5, 1)

		expect(log.getEntries('conn1')).toHaveLength(1)
		expect(log.getEntries('conn2')).toHaveLength(1)
		expect(log.getEntries('conn3')).toHaveLength(0)
	})

	test('entries are isolated per database', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1, undefined, 'db1')
		log.add('conn1', 'SELECT 2', 'success', 5, 1, undefined, 'db2')

		expect(log.getEntries('conn1', 'db1')).toHaveLength(1)
		expect(log.getEntries('conn1', 'db2')).toHaveLength(1)
		expect(log.getEntries('conn1')).toHaveLength(0) // no database = separate key
	})

	test('pending count tracks statements', () => {
		log.add('conn1', 'INSERT INTO t VALUES (1)', 'success', 10, 1)
		log.add('conn1', 'INSERT INTO t VALUES (2)', 'success', 10, 1)

		expect(log.getPendingCount('conn1')).toBe(2)
	})

	test('resetPendingCount clears count', () => {
		log.add('conn1', 'INSERT INTO t VALUES (1)', 'success', 10, 1)
		log.add('conn1', 'INSERT INTO t VALUES (2)', 'success', 10, 1)

		log.resetPendingCount('conn1')
		expect(log.getPendingCount('conn1')).toBe(0)
		// Entries are still there
		expect(log.getEntries('conn1')).toHaveLength(2)
	})

	test('clear removes entries and pending count', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1)
		log.add('conn1', 'SELECT 2', 'success', 5, 1)

		log.clear('conn1')
		expect(log.getEntries('conn1')).toHaveLength(0)
		expect(log.getPendingCount('conn1')).toBe(0)
	})

	test('clear is scoped to connection+database', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1, undefined, 'db1')
		log.add('conn1', 'SELECT 2', 'success', 5, 1, undefined, 'db2')

		log.clear('conn1', 'db1')
		expect(log.getEntries('conn1', 'db1')).toHaveLength(0)
		expect(log.getEntries('conn1', 'db2')).toHaveLength(1)
	})

	test('entries have unique ids and timestamps', () => {
		log.add('conn1', 'SELECT 1', 'success', 10, 1)
		log.add('conn1', 'SELECT 2', 'success', 5, 1)

		const entries = log.getEntries('conn1')
		expect(entries[0].id).toBeTruthy()
		expect(entries[1].id).toBeTruthy()
		expect(entries[0].id).not.toBe(entries[1].id)
		expect(entries[0].executedAt).toBeTruthy()
	})
})
