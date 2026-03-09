import { describe, expect, test } from 'bun:test'
import { formatSql } from '@dotaz/backend-shared/services/sql-formatter'

describe('formatSql', () => {
	test('empty string returns empty', () => {
		expect(formatSql('')).toBe('')
		expect(formatSql('   ')).toBe('')
	})

	test('uppercases keywords', () => {
		const result = formatSql('select name from users where id = 1')
		expect(result).toContain('SELECT')
		expect(result).toContain('FROM')
		expect(result).toContain('WHERE')
	})

	test('puts SELECT on first line', () => {
		const result = formatSql('select id, name from users')
		const lines = result.split('\n')
		expect(lines[0]).toMatch(/^SELECT/)
	})

	test('puts FROM on new line', () => {
		const result = formatSql('select id, name from users')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('FROM'))).toBe(true)
	})

	test('puts WHERE on new line', () => {
		const result = formatSql('select * from users where id = 1')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('WHERE'))).toBe(true)
	})

	test('puts ORDER BY on new line', () => {
		const result = formatSql('select * from users order by name asc')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('ORDER BY'))).toBe(true)
	})

	test('puts GROUP BY on new line', () => {
		const result = formatSql('select count(*) from users group by name')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('GROUP BY'))).toBe(true)
	})

	test('puts HAVING on new line', () => {
		const result = formatSql('select count(*) from users group by name having count(*) > 1')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('HAVING'))).toBe(true)
	})

	test('puts JOIN on new line', () => {
		const result = formatSql('select * from users join orders on users.id = orders.user_id')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('JOIN'))).toBe(true)
	})

	test('puts LEFT JOIN on new line', () => {
		const result = formatSql('select * from users left join orders on users.id = orders.user_id')
		const lines = result.split('\n')
		expect(lines.some((l) => l.startsWith('LEFT JOIN'))).toBe(true)
	})

	test('indents AND', () => {
		const result = formatSql("select * from users where id = 1 and name = 'Alice'")
		const lines = result.split('\n')
		const andLine = lines.find((l) => l.trimStart().startsWith('AND'))
		expect(andLine).toBeTruthy()
		expect(andLine!.startsWith('  ')).toBe(true)
	})

	test('indents OR', () => {
		const result = formatSql('select * from users where id = 1 or id = 2')
		const lines = result.split('\n')
		const orLine = lines.find((l) => l.trimStart().startsWith('OR'))
		expect(orLine).toBeTruthy()
		expect(orLine!.startsWith('  ')).toBe(true)
	})

	test('preserves string literals', () => {
		const result = formatSql("select * from users where name = 'select from where'")
		expect(result).toContain("'select from where'")
	})

	test('preserves double-quoted identifiers', () => {
		const result = formatSql('select "select" from users')
		expect(result).toContain('"select"')
	})

	test('does not break lines inside parentheses', () => {
		const result = formatSql('select * from users where id in (select id from admins)')
		// The subquery inside parens should stay on one line
		const lines = result.split('\n')
		const whereLine = lines.find((l) => l.startsWith('WHERE'))
		expect(whereLine).toBeTruthy()
		expect(whereLine).toContain('(')
		expect(whereLine).toContain(')')
	})

	test('handles INSERT INTO', () => {
		const result = formatSql("insert into users (name, age) values ('Alice', 30)")
		const lines = result.split('\n')
		expect(lines[0]).toMatch(/^INSERT INTO/)
		expect(lines.some((l) => l.startsWith('VALUES'))).toBe(true)
	})

	test('handles UPDATE SET', () => {
		const result = formatSql("update users set name = 'Bob' where id = 1")
		const lines = result.split('\n')
		expect(lines[0]).toMatch(/^UPDATE/)
		expect(lines.some((l) => l.startsWith('SET'))).toBe(true)
		expect(lines.some((l) => l.startsWith('WHERE'))).toBe(true)
	})

	test('handles DELETE FROM', () => {
		const result = formatSql('delete from users where id = 1')
		const lines = result.split('\n')
		expect(lines[0]).toMatch(/^DELETE FROM/)
	})

	test('complex query formatting', () => {
		const sql =
			'select u.id, u.name, count(o.id) as order_count from users u left join orders o on u.id = o.user_id where u.active = true and u.age > 18 group by u.id, u.name having count(o.id) > 0 order by u.name asc limit 10 offset 20'
		const result = formatSql(sql)
		const lines = result.split('\n')

		expect(lines[0]).toMatch(/^SELECT/)
		expect(lines.some((l) => l.startsWith('FROM'))).toBe(true)
		expect(lines.some((l) => l.startsWith('LEFT JOIN'))).toBe(true)
		expect(lines.some((l) => l.startsWith('WHERE'))).toBe(true)
		expect(lines.some((l) => l.startsWith('GROUP BY'))).toBe(true)
		expect(lines.some((l) => l.startsWith('HAVING'))).toBe(true)
		expect(lines.some((l) => l.startsWith('ORDER BY'))).toBe(true)
		expect(lines.some((l) => l.startsWith('LIMIT'))).toBe(true)
	})
})
