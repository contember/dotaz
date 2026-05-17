import { describe, expect, test } from 'bun:test'
import { getIdentifierAtCursor } from '../src/frontend-shared/lib/sql-identifier-at'

describe('getIdentifierAtCursor', () => {
	test('returns ident when cursor sits inside it', () => {
		const sql = 'SELECT * FROM users WHERE id = 1'
		const pos = sql.indexOf('users') + 2
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('users')
		expect(r.from).toBe(sql.indexOf('users'))
		expect(r.to).toBe(sql.indexOf('users') + 5)
		expect(r.schema).toBeUndefined()
	})

	test('extracts schema qualifier', () => {
		const sql = 'SELECT * FROM public.users'
		const pos = sql.indexOf('users') + 2
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('users')
		expect(r.schema).toBe('public')
		expect(r.qualifiedFrom).toBe(sql.indexOf('public'))
	})

	test('handles cursor on schema half of qualified name', () => {
		const sql = 'SELECT * FROM public.users'
		const pos = sql.indexOf('public') + 2
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('public')
		expect(r.schema).toBeUndefined()
	})

	test('handles quoted identifiers', () => {
		const sql = 'SELECT * FROM "My Table"'
		const pos = sql.indexOf('My Table') + 2
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('My Table')
	})

	test('handles quoted schema-qualified identifiers', () => {
		const sql = 'SELECT * FROM "my schema"."My Table"'
		const pos = sql.indexOf('My Table') + 2
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('My Table')
		expect(r.schema).toBe('my schema')
	})

	test('returns null when cursor is on whitespace away from idents', () => {
		const sql = 'SELECT  *  FROM users'
		const r = getIdentifierAtCursor(sql, 7) // between SELECT and *
		// scanWord falls back to forward — finds * which is not an ident, then nothing
		expect(r).toBeNull()
	})

	test('rejects numeric tokens', () => {
		const sql = 'SELECT 123 FROM t'
		const r = getIdentifierAtCursor(sql, 8)
		expect(r).toBeNull()
	})

	test('cursor at end of identifier resolves to that identifier', () => {
		const sql = 'SELECT * FROM users'
		const pos = sql.length
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('users')
	})

	test('cursor at start of identifier resolves to that identifier', () => {
		const sql = 'SELECT * FROM users'
		const pos = sql.indexOf('users')
		const r = getIdentifierAtCursor(sql, pos)!
		expect(r.name).toBe('users')
	})
})
