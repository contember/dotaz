import { describe, expect, test } from 'bun:test'
import { getNextStatementStart, getPreviousStatementStart, getStatementAtCursor } from '../src/frontend-shared/lib/sql-utils'

describe('getStatementAtCursor', () => {
	test('single statement, cursor at start', () => {
		const result = getStatementAtCursor('SELECT 1', 0)
		expect(result?.text).toBe('SELECT 1')
		expect(result?.from).toBe(0)
		expect(result?.to).toBe(8)
	})

	test('single statement, cursor at end', () => {
		const result = getStatementAtCursor('SELECT 1', 8)
		expect(result?.text).toBe('SELECT 1')
		expect(result?.from).toBe(0)
		expect(result?.to).toBe(8)
	})

	test('two statements, cursor in first', () => {
		const result = getStatementAtCursor('SELECT 1; SELECT 2', 3)
		expect(result?.text).toBe('SELECT 1')
		expect(result?.from).toBe(0)
		expect(result?.to).toBe(8)
	})

	test('two statements, cursor in second', () => {
		const result = getStatementAtCursor('SELECT 1; SELECT 2', 12)
		expect(result?.text).toBe('SELECT 2')
		expect(result?.from).toBe(10)
		expect(result?.to).toBe(18)
	})

	test('three statements, cursor in middle', () => {
		const result = getStatementAtCursor('SELECT 1; SELECT 2; SELECT 3', 14)
		expect(result?.text).toBe('SELECT 2')
		expect(result?.from).toBe(10)
		expect(result?.to).toBe(18)
	})

	test('cursor right on semicolon goes to previous statement', () => {
		// Cursor at position 8 is at the semicolon itself — belongs to first statement
		const result = getStatementAtCursor('SELECT 1; SELECT 2', 8)
		expect(result?.text).toBe('SELECT 1')
	})

	test('cursor right after semicolon goes to next statement', () => {
		const result = getStatementAtCursor('SELECT 1; SELECT 2', 9)
		expect(result?.text).toBe('SELECT 2')
	})

	test('handles semicolons inside single-quoted strings', () => {
		const sql = "SELECT 'a;b'; SELECT 2"
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 'a;b'")
		expect(getStatementAtCursor(sql, 16)?.text).toBe('SELECT 2')
	})

	test('handles semicolons inside double-quoted identifiers', () => {
		const sql = 'SELECT "a;b"; SELECT 2'
		expect(getStatementAtCursor(sql, 0)?.text).toBe('SELECT "a;b"')
		expect(getStatementAtCursor(sql, 16)?.text).toBe('SELECT 2')
	})

	test('handles semicolons inside line comments', () => {
		const sql = 'SELECT 1 -- a; comment\n; SELECT 2'
		expect(getStatementAtCursor(sql, 0)?.text).toBe('SELECT 1 -- a; comment')
		expect(getStatementAtCursor(sql, 30)?.text).toBe('SELECT 2')
	})

	test('handles semicolons inside block comments', () => {
		const sql = 'SELECT 1 /* a; b */; SELECT 2'
		expect(getStatementAtCursor(sql, 0)?.text).toBe('SELECT 1 /* a; b */')
		expect(getStatementAtCursor(sql, 25)?.text).toBe('SELECT 2')
	})

	test('handles dollar-quoted strings', () => {
		const sql = 'SELECT $$a;b$$; SELECT 2'
		expect(getStatementAtCursor(sql, 0)?.text).toBe('SELECT $$a;b$$')
		expect(getStatementAtCursor(sql, 20)?.text).toBe('SELECT 2')
	})

	test('handles escaped quotes in single-quoted strings', () => {
		const sql = "SELECT 'a''b;c'; SELECT 2"
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 'a''b;c'")
		expect(getStatementAtCursor(sql, 20)?.text).toBe('SELECT 2')
	})

	test('empty input returns null', () => {
		expect(getStatementAtCursor('', 0)).toBeNull()
	})

	test('whitespace only returns null', () => {
		expect(getStatementAtCursor('   ;  ', 0)).toBeNull()
	})

	test('trailing semicolon', () => {
		expect(getStatementAtCursor('SELECT 1;', 3)?.text).toBe('SELECT 1')
	})

	test('returns correct range for statement with leading whitespace', () => {
		const sql = 'SELECT 1;  SELECT 2  '
		const result = getStatementAtCursor(sql, 14)
		expect(result?.text).toBe('SELECT 2')
		expect(result?.from).toBe(11)
		expect(result?.to).toBe(19)
	})
})

describe('getNextStatementStart', () => {
	test('jumps from first to second statement', () => {
		expect(getNextStatementStart('SELECT 1; SELECT 2', 3)).toBe(10)
	})

	test('jumps from second to third statement', () => {
		expect(getNextStatementStart('SELECT 1; SELECT 2; SELECT 3', 12)).toBe(20)
	})

	test('returns null at last statement', () => {
		expect(getNextStatementStart('SELECT 1; SELECT 2', 12)).toBeNull()
	})

	test('returns null for single statement', () => {
		expect(getNextStatementStart('SELECT 1', 3)).toBeNull()
	})

	test('cursor on semicolon jumps to next statement', () => {
		expect(getNextStatementStart('SELECT 1; SELECT 2', 8)).toBe(10)
	})

	test('skips whitespace after semicolon', () => {
		expect(getNextStatementStart('SELECT 1;   SELECT 2', 3)).toBe(12)
	})

	test('works with multi-line statements', () => {
		const sql = 'SELECT *\nFROM users\nWHERE id = 1;\nSELECT * FROM orders;'
		// Semicolon at 32, \n at 33, S at 34
		expect(getNextStatementStart(sql, 5)).toBe(34)
	})

	test('returns null after trailing semicolon with no more content', () => {
		expect(getNextStatementStart('SELECT 1;', 3)).toBeNull()
	})

	test('handles semicolons inside strings', () => {
		const sql = "SELECT 'a;b'; SELECT 2"
		// Cursor in first statement — real semicolon is at position 12
		expect(getNextStatementStart(sql, 0)).toBe(14)
	})

	test('handles semicolons inside comments', () => {
		const sql = 'SELECT 1 /* a; b */; SELECT 2'
		// Semicolon at 19, space at 20, S at 21
		expect(getNextStatementStart(sql, 0)).toBe(21)
	})

	test('returns null for empty input', () => {
		expect(getNextStatementStart('', 0)).toBeNull()
	})
})

describe('getPreviousStatementStart', () => {
	test('jumps from second to first statement', () => {
		expect(getPreviousStatementStart('SELECT 1; SELECT 2', 12)).toBe(0)
	})

	test('jumps from third to second statement', () => {
		expect(getPreviousStatementStart('SELECT 1; SELECT 2; SELECT 3', 22)).toBe(10)
	})

	test('returns null at first statement', () => {
		expect(getPreviousStatementStart('SELECT 1; SELECT 2', 3)).toBeNull()
	})

	test('returns null for single statement', () => {
		expect(getPreviousStatementStart('SELECT 1', 3)).toBeNull()
	})

	test('cursor at start of second statement goes to first', () => {
		expect(getPreviousStatementStart('SELECT 1; SELECT 2', 10)).toBe(0)
	})

	test('skips leading whitespace to find first non-ws char', () => {
		expect(getPreviousStatementStart('  SELECT 1; SELECT 2', 14)).toBe(2)
	})

	test('works with multi-line statements', () => {
		const sql = 'SELECT *\nFROM users\nWHERE id = 1;\nSELECT * FROM orders;'
		expect(getPreviousStatementStart(sql, 40)).toBe(0)
	})

	test('handles semicolons inside strings', () => {
		const sql = "SELECT 'a;b'; SELECT 2"
		expect(getPreviousStatementStart(sql, 18)).toBe(0)
	})

	test('handles semicolons inside comments', () => {
		const sql = 'SELECT 1 /* a; b */; SELECT 2'
		expect(getPreviousStatementStart(sql, 25)).toBe(0)
	})

	test('returns null for empty input', () => {
		expect(getPreviousStatementStart('', 0)).toBeNull()
	})

	test('three statements, from third to second', () => {
		const sql = 'INSERT INTO t1 VALUES (1); UPDATE t2 SET x = 1; DELETE FROM t3'
		// Cursor in third statement
		expect(getPreviousStatementStart(sql, 55)).toBe(27)
	})
})
