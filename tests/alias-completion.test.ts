import { parseCteNames, resolveTableKey } from '@dotaz/frontend-shared/lib/alias-completion'
import { describe, expect, it } from 'bun:test'

// ── resolveTableKey ──────────────────────────────────────

describe('resolveTableKey', () => {
	it('resolves a simple alias', () => {
		const key = resolveTableKey('o', 'SELECT o. FROM orders o', 'public')
		expect(key).toBe('public.orders')
	})

	it('resolves AS alias', () => {
		const key = resolveTableKey('o', 'SELECT o. FROM orders AS o', 'public')
		expect(key).toBe('public.orders')
	})

	it('resolves alias case-insensitively', () => {
		const key = resolveTableKey('O', 'SELECT O. FROM orders o', 'public')
		expect(key).toBe('public.orders')
	})

	it('resolves unqualified table name directly', () => {
		const key = resolveTableKey('orders', 'SELECT orders. FROM orders', 'public')
		expect(key).toBe('public.orders')
	})

	it('resolves schema-qualified table via alias', () => {
		const key = resolveTableKey('o', 'SELECT o. FROM public.orders o', 'public')
		expect(key).toBe('public.orders')
	})

	it('returns null for unknown alias', () => {
		const key = resolveTableKey('x', 'SELECT x. FROM orders o', 'public')
		expect(key).toBeNull()
	})

	it('resolves alias from JOIN clause', () => {
		const key = resolveTableKey('c', 'SELECT c. FROM orders o JOIN customers c ON o.customer_id = c.id', 'public')
		expect(key).toBe('public.customers')
	})

	it('resolves first table alias when multiple tables', () => {
		const key = resolveTableKey('o', 'SELECT o. FROM orders o JOIN customers c', 'public')
		expect(key).toBe('public.orders')
	})
})

// ── parseCteNames ────────────────────────────────────────

describe('parseCteNames', () => {
	it('parses a single CTE', () => {
		const names = parseCteNames('WITH active_users AS (SELECT * FROM users WHERE active) SELECT * FROM active_users')
		expect(names).toEqual(['active_users'])
	})

	it('parses multiple CTEs', () => {
		const names = parseCteNames('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b')
		expect(names).toEqual(['a', 'b'])
	})

	it('parses RECURSIVE CTE', () => {
		const names = parseCteNames('WITH RECURSIVE tree AS (SELECT * FROM nodes) SELECT * FROM tree')
		expect(names).toEqual(['tree'])
	})

	it('returns empty for no CTEs', () => {
		const names = parseCteNames('SELECT * FROM users')
		expect(names).toEqual([])
	})

	it('handles CTE with no space before parenthesis', () => {
		const names = parseCteNames('WITH cte AS(SELECT 1) SELECT * FROM cte')
		expect(names).toEqual(['cte'])
	})
})
