import { describe, expect, test } from 'bun:test'
import { isConnectionLevelError, syncTxActive } from '../src/backend-shared/drivers/driver-utils'

describe('syncTxActive', () => {
	test('BEGIN sets txActive true', () => {
		const session = { txActive: false }
		syncTxActive(session, 'BEGIN')
		expect(session.txActive).toBe(true)
	})

	test('START TRANSACTION sets txActive true', () => {
		const session = { txActive: false }
		syncTxActive(session, 'START TRANSACTION')
		expect(session.txActive).toBe(true)
	})

	test('COMMIT sets txActive false', () => {
		const session = { txActive: true }
		syncTxActive(session, 'COMMIT')
		expect(session.txActive).toBe(false)
	})

	test('END sets txActive false', () => {
		const session = { txActive: true }
		syncTxActive(session, 'END')
		expect(session.txActive).toBe(false)
	})

	test('ROLLBACK sets txActive false', () => {
		const session = { txActive: true }
		syncTxActive(session, 'ROLLBACK')
		expect(session.txActive).toBe(false)
	})

	test('ROLLBACK TO does not change txActive', () => {
		const session = { txActive: true }
		syncTxActive(session, 'ROLLBACK TO savepoint1')
		expect(session.txActive).toBe(true)
	})

	test('resets txAborted when property exists (PostgreSQL)', () => {
		const session = { txActive: true, txAborted: true }
		syncTxActive(session, 'ROLLBACK')
		expect(session.txActive).toBe(false)
		expect(session.txAborted).toBe(false)
	})

	test('BEGIN resets txAborted when property exists', () => {
		const session = { txActive: false, txAborted: true }
		syncTxActive(session, 'BEGIN')
		expect(session.txActive).toBe(true)
		expect(session.txAborted).toBe(false)
	})

	test('does not add txAborted when property does not exist (MySQL)', () => {
		const session = { txActive: true }
		syncTxActive(session, 'COMMIT')
		expect(session).not.toHaveProperty('txAborted')
	})

	test('ignores non-transaction statements', () => {
		const session = { txActive: false }
		syncTxActive(session, 'SELECT 1')
		expect(session.txActive).toBe(false)
	})

	test('case insensitive', () => {
		const session = { txActive: false }
		syncTxActive(session, 'begin')
		expect(session.txActive).toBe(true)
	})

	test('strips string literals before matching', () => {
		const session = { txActive: false }
		syncTxActive(session, "SELECT 'BEGIN'")
		expect(session.txActive).toBe(false)
	})
})

describe('isConnectionLevelError', () => {
	test('detects ECONNRESET', () => {
		expect(isConnectionLevelError(new Error('read ECONNRESET'))).toBe(true)
	})

	test('detects ECONNREFUSED', () => {
		expect(isConnectionLevelError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true)
	})

	test('detects connection terminated', () => {
		expect(isConnectionLevelError(new Error('Connection terminated unexpectedly'))).toBe(true)
	})

	test('detects socket closed', () => {
		expect(isConnectionLevelError(new Error('socket closed'))).toBe(true)
	})

	test('detects broken pipe', () => {
		expect(isConnectionLevelError(new Error('write EPIPE (broken pipe)'))).toBe(true)
	})

	test('does not match regular SQL errors', () => {
		expect(isConnectionLevelError(new Error('relation "foo" does not exist'))).toBe(false)
	})

	test('does not match syntax errors', () => {
		expect(isConnectionLevelError(new Error('syntax error at or near "SELEC"'))).toBe(false)
	})

	test('handles non-Error values', () => {
		expect(isConnectionLevelError('connection terminated')).toBe(true)
		expect(isConnectionLevelError('some other error')).toBe(false)
	})

	test('detects errors via .code property (ECONNRESET)', () => {
		const err = new Error('some message')
		;(err as any).code = 'ECONNRESET'
		expect(isConnectionLevelError(err)).toBe(true)
	})

	test('detects errors via .code property (ECONNREFUSED)', () => {
		const err = new Error('some message')
		;(err as any).code = 'ECONNREFUSED'
		expect(isConnectionLevelError(err)).toBe(true)
	})

	test('detects errors via .code property (EPIPE)', () => {
		const err = new Error('some message')
		;(err as any).code = 'EPIPE'
		expect(isConnectionLevelError(err)).toBe(true)
	})

	test('detects errors via .code property (ETIMEDOUT)', () => {
		const err = new Error('some message')
		;(err as any).code = 'ETIMEDOUT'
		expect(isConnectionLevelError(err)).toBe(true)
	})

	test('detects errors via .code property (ENOTCONN)', () => {
		const err = new Error('some message')
		;(err as any).code = 'ENOTCONN'
		expect(isConnectionLevelError(err)).toBe(true)
	})

	test('does not match non-connection error codes', () => {
		const err = new Error('some message')
		;(err as any).code = 'ENOENT'
		expect(isConnectionLevelError(err)).toBe(false)
	})

	test('.code takes precedence over message content', () => {
		const err = new Error('unrelated message')
		;(err as any).code = 'ECONNRESET'
		expect(isConnectionLevelError(err)).toBe(true)
	})
})
