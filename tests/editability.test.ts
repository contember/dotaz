import { describe, expect, test } from 'bun:test'
import { analyzeSelectSource } from '@dotaz/shared/sql/editability'

describe('analyzeSelectSource', () => {
	// ── Simple editable SELECTs ──────────────────────────

	test('simple SELECT * FROM table', () => {
		const result = analyzeSelectSource('SELECT * FROM users')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
			expect(result.source.schema).toBeUndefined()
		}
	})

	test('SELECT with specific columns', () => {
		const result = analyzeSelectSource('SELECT id, name, email FROM users')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('schema-qualified table', () => {
		const result = analyzeSelectSource('SELECT * FROM public.users')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.schema).toBe('public')
			expect(result.source.table).toBe('users')
		}
	})

	test('quoted table name', () => {
		const result = analyzeSelectSource('SELECT * FROM "Users"')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('Users')
		}
	})

	test('quoted schema and table', () => {
		const result = analyzeSelectSource('SELECT * FROM "public"."Users"')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.schema).toBe('public')
			expect(result.source.table).toBe('Users')
		}
	})

	test('backtick-quoted (MySQL)', () => {
		const result = analyzeSelectSource('SELECT * FROM `users`')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('SELECT with WHERE clause', () => {
		const result = analyzeSelectSource('SELECT * FROM users WHERE id = 1')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('SELECT with ORDER BY', () => {
		const result = analyzeSelectSource('SELECT * FROM users ORDER BY name')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('SELECT with LIMIT', () => {
		const result = analyzeSelectSource('SELECT * FROM users LIMIT 10')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('SELECT DISTINCT is editable', () => {
		const result = analyzeSelectSource('SELECT DISTINCT * FROM users')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('SELECT with alias', () => {
		const result = analyzeSelectSource('SELECT * FROM users AS u')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('case insensitive keywords', () => {
		const result = analyzeSelectSource('select * from Users where id > 5')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('Users')
		}
	})

	test('WHERE clause with subquery is still editable', () => {
		const result = analyzeSelectSource(
			'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)',
		)
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	// ── Non-editable: not SELECT ─────────────────────────

	test('INSERT is not editable', () => {
		const result = analyzeSelectSource("INSERT INTO users (name) VALUES ('test')")
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('not_select')
		}
	})

	test('UPDATE is not editable', () => {
		const result = analyzeSelectSource("UPDATE users SET name = 'test' WHERE id = 1")
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('not_select')
		}
	})

	test('DELETE is not editable', () => {
		const result = analyzeSelectSource('DELETE FROM users WHERE id = 1')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('not_select')
		}
	})

	// ── Non-editable: aggregation ────────────────────────

	test('GROUP BY is not editable', () => {
		const result = analyzeSelectSource('SELECT department, COUNT(*) FROM users GROUP BY department')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('aggregation')
		}
	})

	test('HAVING is not editable', () => {
		const result = analyzeSelectSource(
			'SELECT department FROM users GROUP BY department HAVING COUNT(*) > 5',
		)
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('aggregation')
		}
	})

	test('COUNT(*) without GROUP BY is not editable', () => {
		const result = analyzeSelectSource('SELECT COUNT(*) FROM users')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('aggregation')
		}
	})

	test('SUM() is not editable', () => {
		const result = analyzeSelectSource('SELECT SUM(amount) FROM orders')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('aggregation')
		}
	})

	test('AVG() is not editable', () => {
		const result = analyzeSelectSource('SELECT AVG(price) FROM products')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('aggregation')
		}
	})

	// ── Non-editable: UNION ──────────────────────────────

	test('UNION is not editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users UNION SELECT * FROM admins')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('union')
		}
	})

	test('UNION ALL is not editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users UNION ALL SELECT * FROM admins')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('union')
		}
	})

	test('INTERSECT is not editable', () => {
		const result = analyzeSelectSource('SELECT id FROM a INTERSECT SELECT id FROM b')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('union')
		}
	})

	test('EXCEPT is not editable', () => {
		const result = analyzeSelectSource('SELECT id FROM a EXCEPT SELECT id FROM b')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('union')
		}
	})

	// ── Non-editable: JOIN ───────────────────────────────

	test('INNER JOIN is not editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users JOIN orders ON users.id = orders.user_id')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('multi_table')
		}
	})

	test('LEFT JOIN is not editable', () => {
		const result = analyzeSelectSource(
			'SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id',
		)
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('multi_table')
		}
	})

	test('comma-separated tables not editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users, orders WHERE users.id = orders.user_id')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('multi_table')
		}
	})

	// ── Non-editable: subqueries ─────────────────────────

	test('subquery in FROM is not editable', () => {
		const result = analyzeSelectSource('SELECT * FROM (SELECT * FROM users) AS sub')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('subquery')
		}
	})

	test('subquery in SELECT list is not editable', () => {
		const result = analyzeSelectSource(
			'SELECT id, (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id) AS order_count FROM users',
		)
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('subquery')
		}
	})

	test('CTE (WITH) is not editable', () => {
		const result = analyzeSelectSource(
			"WITH recent AS (SELECT * FROM users WHERE created > '2024-01-01') SELECT * FROM recent",
		)
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('subquery')
		}
	})

	// ── Edge cases ───────────────────────────────────────

	test('string literal containing keywords is still editable', () => {
		const result = analyzeSelectSource("SELECT * FROM users WHERE name = 'JOIN the party'")
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('comment containing keywords is still editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users -- GROUP BY something')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('block comment containing keywords is still editable', () => {
		const result = analyzeSelectSource('SELECT * FROM users /* UNION SELECT * FROM admins */')
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})

	test('empty SQL is not editable', () => {
		const result = analyzeSelectSource('')
		expect(result.editable).toBe(false)
	})

	test('whitespace-only SQL is not editable', () => {
		const result = analyzeSelectSource('   ')
		expect(result.editable).toBe(false)
	})

	test('SELECT without FROM is not editable', () => {
		const result = analyzeSelectSource('SELECT 1 + 1')
		expect(result.editable).toBe(false)
		if (!result.editable) {
			expect(result.reason).toBe('not_select')
		}
	})

	test('multiline query', () => {
		const result = analyzeSelectSource(`
			SELECT
				id,
				name,
				email
			FROM users
			WHERE active = true
			ORDER BY name
		`)
		expect(result.editable).toBe(true)
		if (result.editable) {
			expect(result.source.table).toBe('users')
		}
	})
})
