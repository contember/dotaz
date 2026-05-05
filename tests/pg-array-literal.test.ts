/**
 * Unit tests for PG array literal formatter + integration test against a live
 * PostgreSQL container confirming Bun.SQL accepts the literals we produce.
 */
import { PostgresDriver } from '@dotaz/backend-shared/drivers/postgres-driver'
import { isArrayType, isStructuredType } from '@dotaz/shared/column-types'
import { formatPgArrayLiteral, PostgresDialect, serializeValueForDialect, SqliteDialect } from '@dotaz/shared/sql'
import type { PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

describe('formatPgArrayLiteral', () => {
	test('formats simple text array', () => {
		expect(formatPgArrayLiteral(['a', 'b', 'c'])).toBe('{a,b,c}')
	})

	test('formats numeric array', () => {
		expect(formatPgArrayLiteral([1, 2, 3])).toBe('{1,2,3}')
	})

	test('formats empty array', () => {
		expect(formatPgArrayLiteral([])).toBe('{}')
	})

	test('handles NULL elements', () => {
		expect(formatPgArrayLiteral(['a', null, 'b'])).toBe('{a,NULL,b}')
	})

	test('quotes empty string elements', () => {
		expect(formatPgArrayLiteral(['', 'x'])).toBe('{"",x}')
	})

	test('quotes elements with delimiters/whitespace', () => {
		expect(formatPgArrayLiteral(['hello world', 'a,b'])).toBe('{"hello world","a,b"}')
	})

	test('escapes backslashes and quotes inside elements', () => {
		expect(formatPgArrayLiteral(['a\\b', 'a"b'])).toBe('{"a\\\\b","a\\"b"}')
	})

	test('quotes elements that look like NULL keyword', () => {
		expect(formatPgArrayLiteral(['null', 'NULL', 'Null'])).toBe('{"null","NULL","Null"}')
	})

	test('formats booleans', () => {
		expect(formatPgArrayLiteral([true, false])).toBe('{true,false}')
	})

	test('formats nested arrays (multidim)', () => {
		expect(formatPgArrayLiteral([[1, 2], [3, 4]])).toBe('{{1,2},{3,4}}')
	})
})

describe('isArrayType / isStructuredType', () => {
	test('Array column is array & structured', () => {
		expect(isArrayType(DatabaseDataType.Array)).toBe(true)
		expect(isStructuredType(DatabaseDataType.Array)).toBe(true)
	})
	test('Json column is structured but not array', () => {
		expect(isArrayType(DatabaseDataType.Json)).toBe(false)
		expect(isStructuredType(DatabaseDataType.Json)).toBe(true)
	})
	test('scalar columns are neither', () => {
		expect(isStructuredType(DatabaseDataType.Text)).toBe(false)
		expect(isStructuredType(DatabaseDataType.Integer)).toBe(false)
	})
})

describe('serializeValueForDialect', () => {
	const pg = new PostgresDialect()
	const sqlite = new SqliteDialect()

	test('PG array column: JS array becomes PG literal string', () => {
		expect(serializeValueForDialect(['a', 'b'], DatabaseDataType.Array, pg)).toBe('{a,b}')
	})

	test('PG array column: null is preserved', () => {
		expect(serializeValueForDialect(null, DatabaseDataType.Array, pg)).toBe(null)
	})

	test('PG json column: JS array stays as JS array (Bun.SQL JSON-stringifies)', () => {
		expect(serializeValueForDialect(['a', 'b'], DatabaseDataType.Json, pg)).toEqual(['a', 'b'])
	})

	test('non-PG dialect: arrays untouched', () => {
		expect(serializeValueForDialect(['a', 'b'], DatabaseDataType.Array, sqlite)).toEqual(['a', 'b'])
	})

	test('PG scalar column: untouched', () => {
		expect(serializeValueForDialect('hello', DatabaseDataType.Text, pg)).toBe('hello')
	})
})

// ── Integration: Bun.SQL accepts our literals ────────────────────────────

const config: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5488,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

let driver: PostgresDriver

beforeAll(async () => {
	driver = new PostgresDriver()
	await driver.connect(config)
	await driver.execute('DROP TABLE IF EXISTS arr_roundtrip')
	await driver.execute(
		'CREATE TABLE arr_roundtrip (id serial PRIMARY KEY, tags text[], nums int[], jsondata jsonb)',
	)
}, 30_000)

afterAll(async () => {
	if (driver.isConnected()) {
		await driver.execute('DROP TABLE IF EXISTS arr_roundtrip')
		await driver.disconnect()
	}
})

describe('PG array round-trip via dialect serializer', () => {
	test('text[] survives a round-trip through serializeValueForDialect', async () => {
		const pg = new PostgresDialect()
		const original = ['hello world', 'a,b', 'simple']
		const wireValue = serializeValueForDialect(original, DatabaseDataType.Array, pg)
		await driver.execute('INSERT INTO arr_roundtrip (tags) VALUES ($1)', [wireValue])
		const result = await driver.execute('SELECT tags FROM arr_roundtrip ORDER BY id DESC LIMIT 1')
		expect(result.rows[0].tags).toEqual(original)
	})

	test('int[] survives a round-trip', async () => {
		const pg = new PostgresDialect()
		const original = [1, 2, 3, 42]
		const wireValue = serializeValueForDialect(original, DatabaseDataType.Array, pg)
		await driver.execute('INSERT INTO arr_roundtrip (nums) VALUES ($1)', [wireValue])
		const result = await driver.execute('SELECT nums FROM arr_roundtrip ORDER BY id DESC LIMIT 1')
		expect(result.rows[0].nums).toEqual(original)
	})

	test('text[] with NULL element survives round-trip', async () => {
		const pg = new PostgresDialect()
		const original = ['a', null, 'b']
		const wireValue = serializeValueForDialect(original, DatabaseDataType.Array, pg)
		await driver.execute('INSERT INTO arr_roundtrip (tags) VALUES ($1)', [wireValue])
		const result = await driver.execute('SELECT tags FROM arr_roundtrip ORDER BY id DESC LIMIT 1')
		expect(result.rows[0].tags).toEqual(original)
	})

	test('jsonb passes through unchanged: JS object → JSONB', async () => {
		const pg = new PostgresDialect()
		const original = { role: 'admin', tags: ['x', 'y'] }
		const wireValue = serializeValueForDialect(original, DatabaseDataType.Json, pg)
		// Bun.SQL serializes the object to JSON when binding to jsonb
		await driver.execute('INSERT INTO arr_roundtrip (jsondata) VALUES ($1)', [wireValue])
		const result = await driver.execute('SELECT jsondata FROM arr_roundtrip ORDER BY id DESC LIMIT 1')
		expect(result.rows[0].jsondata).toEqual(original)
	})

	test('jsonb: array stored as JSON array (not double-escaped)', async () => {
		const pg = new PostgresDialect()
		const original = ['login', 'admin']
		const wireValue = serializeValueForDialect(original, DatabaseDataType.Json, pg)
		await driver.execute('INSERT INTO arr_roundtrip (jsondata) VALUES ($1)', [wireValue])
		// Read back: must come out as a JS array (jsonb_typeof = 'array'),
		// not as a string `"[\"login\",\"admin\"]"` (jsonb_typeof = 'string').
		const result = await driver.execute(
			'SELECT jsondata, jsonb_typeof(jsondata) AS jt FROM arr_roundtrip ORDER BY id DESC LIMIT 1',
		)
		expect(result.rows[0].jt).toBe('array')
		expect(result.rows[0].jsondata).toEqual(original)
	})

	test('jsonb: regression check — passing a STRING reproduces the double-escape bug', async () => {
		// Documents Bun.SQL's behaviour: a JS string bound to a jsonb param is
		// JSON.stringify-d again, so the column ends up with a JSON-string
		// scalar instead of an array. This is exactly what the inline editor
		// used to produce before parseJsonColumnInput; the test pins down the
		// reason we now must hand a parsed JS value through the wire.
		await driver.execute('INSERT INTO arr_roundtrip (jsondata) VALUES ($1)', ['["login","admin"]'])
		const result = await driver.execute(
			'SELECT jsonb_typeof(jsondata) AS jt FROM arr_roundtrip ORDER BY id DESC LIMIT 1',
		)
		expect(result.rows[0].jt).toBe('string')
	})
})
