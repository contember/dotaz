import { describe, expect, test } from 'bun:test'
import { detectDestructiveWithoutWhere } from '@dotaz/shared/sql/statements'

describe('detectDestructiveWithoutWhere', () => {
	// ── DELETE cases ─────────────────────────────────────
	test('DELETE FROM without WHERE is destructive', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM users')).toBe(true)
	})

	test('DELETE FROM with WHERE is safe', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM users WHERE id = 1')).toBe(false)
	})

	test('DELETE with schema-qualified table without WHERE is destructive', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM public.users')).toBe(true)
	})

	test('DELETE with schema-qualified table with WHERE is safe', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM public.users WHERE id = 1')).toBe(false)
	})

	test('DELETE case-insensitive', () => {
		expect(detectDestructiveWithoutWhere('delete from users')).toBe(true)
		expect(detectDestructiveWithoutWhere('Delete From users Where id = 1')).toBe(false)
	})

	// ── UPDATE cases ─────────────────────────────────────
	test('UPDATE without WHERE is destructive', () => {
		expect(detectDestructiveWithoutWhere("UPDATE users SET name = 'foo'")).toBe(true)
	})

	test('UPDATE with WHERE is safe', () => {
		expect(detectDestructiveWithoutWhere("UPDATE users SET name = 'foo' WHERE id = 1")).toBe(false)
	})

	test('UPDATE case-insensitive', () => {
		expect(detectDestructiveWithoutWhere("update users set name = 'foo'")).toBe(true)
		expect(detectDestructiveWithoutWhere("Update users Set name = 'foo' Where id = 1")).toBe(false)
	})

	test('UPDATE with multiple SET columns without WHERE', () => {
		expect(detectDestructiveWithoutWhere("UPDATE users SET name = 'foo', age = 30")).toBe(true)
	})

	// ── Safe statements ──────────────────────────────────
	test('SELECT is not destructive', () => {
		expect(detectDestructiveWithoutWhere('SELECT * FROM users')).toBe(false)
	})

	test('INSERT is not destructive', () => {
		expect(detectDestructiveWithoutWhere("INSERT INTO users (name) VALUES ('foo')")).toBe(false)
	})

	test('CREATE TABLE is not destructive', () => {
		expect(detectDestructiveWithoutWhere('CREATE TABLE test (id INT)')).toBe(false)
	})

	// ── String literals ──────────────────────────────────
	test('WHERE inside string literal is not real WHERE', () => {
		expect(detectDestructiveWithoutWhere("UPDATE users SET name = 'WHERE id = 1'")).toBe(true)
	})

	test('DELETE inside string literal is not real DELETE', () => {
		expect(detectDestructiveWithoutWhere("SELECT 'DELETE FROM users'")).toBe(false)
	})

	// ── Comments ─────────────────────────────────────────
	test('WHERE inside line comment is not real WHERE', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM users -- WHERE id = 1')).toBe(true)
	})

	test('WHERE inside block comment is not real WHERE', () => {
		expect(detectDestructiveWithoutWhere('DELETE FROM users /* WHERE id = 1 */')).toBe(true)
	})

	test('DELETE inside comment is not real DELETE', () => {
		expect(detectDestructiveWithoutWhere('-- DELETE FROM users\nSELECT 1')).toBe(false)
	})

	// ── Dollar-quoted strings (PostgreSQL) ───────────────
	test('WHERE inside dollar-quoted string is not real WHERE', () => {
		expect(detectDestructiveWithoutWhere('UPDATE users SET body = $$WHERE id = 1$$')).toBe(true)
	})

	// ── Whitespace handling ──────────────────────────────
	test('handles extra whitespace', () => {
		expect(detectDestructiveWithoutWhere('  DELETE   FROM   users  ')).toBe(true)
		expect(detectDestructiveWithoutWhere("  UPDATE   users   SET   name = 'x'  ")).toBe(true)
	})

	test('multiline DELETE without WHERE', () => {
		expect(detectDestructiveWithoutWhere('DELETE\nFROM\nusers')).toBe(true)
	})

	test('multiline UPDATE without WHERE', () => {
		expect(detectDestructiveWithoutWhere("UPDATE users\nSET name = 'x'")).toBe(true)
	})
})
