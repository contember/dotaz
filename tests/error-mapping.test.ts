/**
 * Tests for domain error mapping — validates that native database errors
 * are correctly mapped to domain error types.
 *
 * Run: bun test tests/error-mapping.test.ts
 */
import { mapMysqlError, mapPostgresError, mapSqliteError } from '@dotaz/backend-shared/db/error-mapping'
import {
	AuthenticationError,
	ConnectionError,
	ConstraintError,
	DatabaseError,
	friendlyMessageForCode,
	QueryError,
	serializeError,
} from '@dotaz/shared/types/errors'
import { describe, expect, test } from 'bun:test'

// ── PostgreSQL error mapping ────────────────────────────────

describe('mapPostgresError', () => {
	test('maps ECONNREFUSED to ConnectionError', () => {
		const err = mapPostgresError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_REFUSED')
	})

	test('maps timeout to ConnectionError', () => {
		const err = mapPostgresError(new Error('Connection timed out'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_TIMEOUT')
	})

	test('maps ENOTFOUND to ConnectionError', () => {
		const err = mapPostgresError(new Error('getaddrinfo ENOTFOUND bad.host'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('HOST_NOT_FOUND')
	})

	test('maps SSL error to ConnectionError', () => {
		const err = mapPostgresError(new Error('SSL connection error'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('SSL_ERROR')
	})

	test('maps too many connections to ConnectionError', () => {
		const err = mapPostgresError(new Error('too many connections for role'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_LIMIT')
	})

	test('maps password authentication failure to AuthenticationError', () => {
		const err = mapPostgresError(new Error('password authentication failed for user "test"'))
		expect(err).toBeInstanceOf(AuthenticationError)
		expect(err.code).toBe('AUTH_FAILED')
	})

	test('maps SQLSTATE 28P01 to AuthenticationError', () => {
		const pgErr = Object.assign(new Error('auth failed'), { code: '28P01' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(AuthenticationError)
		expect(err.code).toBe('AUTH_FAILED')
	})

	test('maps database not found to ConnectionError', () => {
		const err = mapPostgresError(new Error('database "nope" does not exist'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('DATABASE_NOT_FOUND')
	})

	test('maps SQLSTATE 3D000 to DATABASE_NOT_FOUND', () => {
		const pgErr = Object.assign(new Error('db not found'), { code: '3D000' })
		const err = mapPostgresError(pgErr)
		expect(err.code).toBe('DATABASE_NOT_FOUND')
	})

	test('maps unique constraint violation to ConstraintError', () => {
		const pgErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_UNIQUE')
	})

	test('maps FK violation to ConstraintError', () => {
		const pgErr = Object.assign(new Error('violates foreign key constraint'), { code: '23503' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_FK')
	})

	test('maps check constraint violation to ConstraintError', () => {
		const pgErr = Object.assign(new Error('violates check constraint'), { code: '23514' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_CHECK')
	})

	test('maps not-null violation to ConstraintError', () => {
		const pgErr = Object.assign(new Error('violates not-null constraint'), { code: '23502' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_NOT_NULL')
	})

	test('maps syntax error to QueryError', () => {
		const pgErr = Object.assign(new Error('syntax error at or near "SELCT"'), { code: '42601' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('QUERY_SYNTAX')
	})

	test('maps undefined table to QueryError', () => {
		const pgErr = Object.assign(new Error('relation "foo" does not exist'), { code: '42P01' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('TABLE_NOT_FOUND')
	})

	test('maps undefined column to QueryError', () => {
		const pgErr = Object.assign(new Error('column "bar" does not exist'), { code: '42703' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('COLUMN_NOT_FOUND')
	})

	test('maps permission denied to DatabaseError', () => {
		const pgErr = Object.assign(new Error('permission denied for table users'), { code: '42501' })
		const err = mapPostgresError(pgErr)
		expect(err).toBeInstanceOf(DatabaseError)
		expect(err.code).toBe('PERMISSION_DENIED')
	})

	test('maps unknown errors to DatabaseError with UNKNOWN code', () => {
		const err = mapPostgresError(new Error('something unexpected'))
		expect(err).toBeInstanceOf(DatabaseError)
		expect(err.code).toBe('UNKNOWN')
	})

	test('preserves original error as cause', () => {
		const original = new Error('original error')
		const err = mapPostgresError(original)
		expect(err.cause).toBe(original)
	})
})

// ── SQLite error mapping ────────────────────────────────────

describe('mapSqliteError', () => {
	test('maps UNIQUE constraint to ConstraintError', () => {
		const err = mapSqliteError(new Error('UNIQUE constraint failed: users.email'))
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_UNIQUE')
	})

	test('maps FOREIGN KEY constraint to ConstraintError', () => {
		const err = mapSqliteError(new Error('FOREIGN KEY constraint failed'))
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_FK')
	})

	test('maps CHECK constraint to ConstraintError', () => {
		const err = mapSqliteError(new Error('CHECK constraint failed: age_positive'))
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_CHECK')
	})

	test('maps NOT NULL constraint to ConstraintError', () => {
		const err = mapSqliteError(new Error('NOT NULL constraint failed: users.name'))
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_NOT_NULL')
	})

	test('maps no such table to QueryError', () => {
		const err = mapSqliteError(new Error('no such table: missing_table'))
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('TABLE_NOT_FOUND')
	})

	test('maps no such column to QueryError', () => {
		const err = mapSqliteError(new Error('no such column: bad_col'))
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('COLUMN_NOT_FOUND')
	})

	test('maps syntax error to QueryError', () => {
		const err = mapSqliteError(new Error('near "SELCT": syntax error'))
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('QUERY_SYNTAX')
	})

	test('maps unable to open database to ConnectionError', () => {
		const err = mapSqliteError(new Error('unable to open database file'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_REFUSED')
	})

	test('maps unknown errors to DatabaseError with UNKNOWN code', () => {
		const err = mapSqliteError(new Error('some other error'))
		expect(err).toBeInstanceOf(DatabaseError)
		expect(err.code).toBe('UNKNOWN')
	})

	test('preserves original error as cause', () => {
		const original = new Error('UNIQUE constraint failed')
		const err = mapSqliteError(original)
		expect(err.cause).toBe(original)
	})
})

// ── MySQL error mapping ─────────────────────────────────────

describe('mapMysqlError', () => {
	test('maps ECONNREFUSED to ConnectionError', () => {
		const err = mapMysqlError(new Error('connect ECONNREFUSED'))
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_REFUSED')
	})

	test('maps errno 2003 to ConnectionError', () => {
		const mysqlErr = Object.assign(new Error("Can't connect"), { errno: 2003 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_REFUSED')
	})

	test('maps access denied to AuthenticationError', () => {
		const mysqlErr = Object.assign(new Error("Access denied for user 'test'"), { errno: 1045 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(AuthenticationError)
		expect(err.code).toBe('AUTH_FAILED')
	})

	test('maps unknown database to ConnectionError', () => {
		const mysqlErr = Object.assign(new Error("Unknown database 'nope'"), { errno: 1049 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('DATABASE_NOT_FOUND')
	})

	test('maps duplicate entry to ConstraintError', () => {
		const mysqlErr = Object.assign(new Error("Duplicate entry 'x' for key"), { errno: 1062 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_UNIQUE')
	})

	test('maps FK violation to ConstraintError (errno 1452)', () => {
		const mysqlErr = Object.assign(new Error('Cannot add or update a child row'), { errno: 1452 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_FK')
	})

	test('maps FK violation to ConstraintError (errno 1451)', () => {
		const mysqlErr = Object.assign(new Error('Cannot delete or update a parent row'), { errno: 1451 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_FK')
	})

	test('maps NOT NULL to ConstraintError', () => {
		const mysqlErr = Object.assign(new Error("Column 'name' cannot be null"), { errno: 1048 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConstraintError)
		expect(err.code).toBe('CONSTRAINT_NOT_NULL')
	})

	test('maps syntax error to QueryError', () => {
		const mysqlErr = Object.assign(new Error('You have an error in your SQL syntax'), { errno: 1064 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('QUERY_SYNTAX')
	})

	test('maps table not found to QueryError', () => {
		const mysqlErr = Object.assign(new Error("Table 'test.missing' doesn't exist"), { errno: 1146 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('TABLE_NOT_FOUND')
	})

	test('maps unknown column to QueryError', () => {
		const mysqlErr = Object.assign(new Error("Unknown column 'bad' in field list"), { errno: 1054 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(QueryError)
		expect(err.code).toBe('COLUMN_NOT_FOUND')
	})

	test('maps too many connections to ConnectionError', () => {
		const mysqlErr = Object.assign(new Error('Too many connections'), { errno: 1040 })
		const err = mapMysqlError(mysqlErr)
		expect(err).toBeInstanceOf(ConnectionError)
		expect(err.code).toBe('CONNECTION_LIMIT')
	})

	test('maps unknown errors to DatabaseError with UNKNOWN code', () => {
		const err = mapMysqlError(new Error('something unexpected'))
		expect(err).toBeInstanceOf(DatabaseError)
		expect(err.code).toBe('UNKNOWN')
	})

	test('preserves original error as cause', () => {
		const original = new Error('some error')
		const err = mapMysqlError(original)
		expect(err.cause).toBe(original)
	})
})

// ── Serialization ────────────────────────────────────────────

describe('serializeError', () => {
	test('serializes DatabaseError with code', () => {
		const err = new QueryError('QUERY_SYNTAX', "syntax error near 'SELCT'")
		const serialized = serializeError(err)
		expect(serialized).toEqual({ code: 'QUERY_SYNTAX', message: "syntax error near 'SELCT'" })
	})

	test('serializes plain Error with UNKNOWN code', () => {
		const serialized = serializeError(new Error('something broke'))
		expect(serialized).toEqual({ code: 'UNKNOWN', message: 'something broke' })
	})

	test('serializes non-Error value with UNKNOWN code', () => {
		const serialized = serializeError('string error')
		expect(serialized).toEqual({ code: 'UNKNOWN', message: 'string error' })
	})
})

// ── Friendly messages ────────────────────────────────────────

describe('friendlyMessageForCode', () => {
	test('returns friendly message for connection errors', () => {
		expect(friendlyMessageForCode('CONNECTION_REFUSED', 'raw')).toBe('Connection refused \u2014 is the database server running?')
		expect(friendlyMessageForCode('AUTH_FAILED', 'raw')).toBe('Authentication failed \u2014 check username and password')
	})

	test('returns raw message for query errors', () => {
		const raw = 'syntax error at or near "SELCT"'
		expect(friendlyMessageForCode('QUERY_SYNTAX', raw)).toBe(raw)
	})

	test('returns raw message for constraint errors', () => {
		const raw = 'UNIQUE constraint failed: users.email'
		expect(friendlyMessageForCode('CONSTRAINT_UNIQUE', raw)).toBe(raw)
	})

	test('returns raw message for unknown code', () => {
		expect(friendlyMessageForCode('UNKNOWN', 'some error')).toBe('some error')
	})

	test('returns fallback for empty unknown message', () => {
		expect(friendlyMessageForCode('UNKNOWN', '')).toBe('An unexpected error occurred')
	})
})

// ── SQLite driver integration ────────────────────────────────

describe('SQLite driver error mapping integration', () => {
	const { SqliteDriver } = require('../src/backend-shared/drivers/sqlite-driver')

	test('throws QueryError for syntax error', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })

		try {
			await driver.execute('SELCT 1')
			expect(true).toBe(false) // should not reach
		} catch (err) {
			expect(err).toBeInstanceOf(QueryError)
			expect((err as QueryError).code).toBe('QUERY_SYNTAX')
		} finally {
			await driver.disconnect()
		}
	})

	test('throws QueryError for missing table', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })

		try {
			await driver.execute('SELECT * FROM nonexistent_table')
			expect(true).toBe(false)
		} catch (err) {
			expect(err).toBeInstanceOf(QueryError)
			expect((err as QueryError).code).toBe('TABLE_NOT_FOUND')
		} finally {
			await driver.disconnect()
		}
	})

	test('throws ConstraintError for unique violation', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })

		await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
		await driver.execute("INSERT INTO t VALUES (1, 'alice')")

		try {
			await driver.execute("INSERT INTO t VALUES (2, 'alice')")
			expect(true).toBe(false)
		} catch (err) {
			expect(err).toBeInstanceOf(ConstraintError)
			expect((err as ConstraintError).code).toBe('CONSTRAINT_UNIQUE')
		} finally {
			await driver.disconnect()
		}
	})

	test('throws ConstraintError for NOT NULL violation', async () => {
		const driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })

		await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')

		try {
			await driver.execute('INSERT INTO t (id) VALUES (1)')
			expect(true).toBe(false)
		} catch (err) {
			expect(err).toBeInstanceOf(ConstraintError)
			expect((err as ConstraintError).code).toBe('CONSTRAINT_NOT_NULL')
		} finally {
			await driver.disconnect()
		}
	})
})
