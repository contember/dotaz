import { stripLiteralsAndComments } from '@dotaz/shared/sql/statements'
import { describe, expect, test } from 'bun:test'

describe('stripLiteralsAndComments', () => {
	test('passes through plain SQL unchanged', () => {
		expect(stripLiteralsAndComments('SELECT 1')).toBe('SELECT 1')
	})

	test('strips line comments', () => {
		const result = stripLiteralsAndComments('-- comment\nSELECT 1')
		expect(result.trim()).toBe('SELECT 1')
	})

	test('strips block comments', () => {
		const result = stripLiteralsAndComments('/* comment */ SELECT 1')
		expect(result).toContain('SELECT 1')
		expect(result).not.toContain('comment')
	})

	test('strips single-quoted strings', () => {
		const result = stripLiteralsAndComments("SELECT 'hello'")
		expect(result).not.toContain('hello')
	})

	test('strips dollar-quoted strings', () => {
		const result = stripLiteralsAndComments('DO $$ BEGIN RAISE NOTICE 1; END $$')
		expect(result).not.toContain('BEGIN')
		expect(result).not.toContain('END')
		expect(result).toContain('DO')
	})

	// ── Edge cases from TXSYNC-2 ──────────────────────

	test('line comment containing BEGIN is stripped', () => {
		// "-- BEGIN\nSELECT 1" should not contain BEGIN after stripping
		const result = stripLiteralsAndComments('-- BEGIN\nSELECT 1')
		expect(result).not.toContain('BEGIN')
		expect(result.trim()).toBe('SELECT 1')
	})

	test('leading comment before BEGIN is stripped, revealing BEGIN', () => {
		// "-- start tx\nBEGIN" should yield BEGIN after stripping
		const result = stripLiteralsAndComments('-- start tx\nBEGIN')
		expect(result.trim()).toBe('BEGIN')
	})

	test('block comment before COMMIT is stripped', () => {
		const result = stripLiteralsAndComments('/* done */ COMMIT')
		expect(result.trim()).toBe('COMMIT')
	})

	test('PL/pgSQL DO block with dollar quoting strips body', () => {
		const sql = 'DO $$ BEGIN PERFORM 1; END $$'
		const result = stripLiteralsAndComments(sql)
		// Dollar-quoted body is replaced with space, only DO and surrounding text remain
		const upper = result.trim().toUpperCase()
		expect(upper.startsWith('DO')).toBe(true)
		expect(/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)).toBe(false)
	})

	test('tagged dollar quoting strips body', () => {
		const sql = 'DO $fn$ BEGIN RETURN 1; END $fn$'
		const result = stripLiteralsAndComments(sql)
		const upper = result.trim().toUpperCase()
		expect(upper.startsWith('DO')).toBe(true)
		expect(upper).not.toContain('RETURN')
	})

	test('syncTxActive pattern: comment-prefixed BEGIN is detected after stripping', () => {
		// Simulating what syncTxActive now does
		const sql = '-- start transaction\nBEGIN'
		const upper = stripLiteralsAndComments(sql).trim().toUpperCase()
		expect(/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)).toBe(true)
	})

	test('syncTxActive pattern: comment-only BEGIN is not detected', () => {
		const sql = '-- BEGIN'
		const upper = stripLiteralsAndComments(sql).trim().toUpperCase()
		expect(/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)).toBe(false)
	})

	test('syncTxActive pattern: DO $$ block does not trigger BEGIN', () => {
		const sql = 'DO $$ BEGIN PERFORM pg_sleep(1); END $$'
		const upper = stripLiteralsAndComments(sql).trim().toUpperCase()
		expect(/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)).toBe(false)
	})

	test('syncTxActive pattern: DO $$ block does not trigger END', () => {
		const sql = 'DO $$ BEGIN PERFORM 1; END $$'
		const upper = stripLiteralsAndComments(sql).trim().toUpperCase()
		expect(/^(COMMIT|END)\b/.test(upper)).toBe(false)
	})
})
