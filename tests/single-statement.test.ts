/**
 * `isSingleStatement` is the read-only session's multi-statement guard. It must never call a
 * multi-statement string "single" — that is what let a read-only session flip itself to read-write
 * and write (see the bypass payloads below, all confirmed against live Postgres/MySQL). A false
 * rejection of an exotic single statement is acceptable; a false pass is a security hole.
 */
import { isSingleStatement, isWhereFragment } from '@dotaz/shared/sql/single-statement'
import { describe, expect, test } from 'bun:test'

const PG_FLIP = 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE; COMMIT'
const MY_FLIP = 'SET SESSION TRANSACTION READ WRITE'

// Every entry hides `INSERT INTO t VALUES (1)` behind a leading read, exploiting a specific
// disagreement between a hand-rolled tokenizer and the real lexer. Each of these wrote to a live
// database before the guard existed.
const POSTGRES_BYPASSES: Record<string, string> = {
	'dollar-quote touching an identifier (x$$)': `SELECT 1 AS x$$; ${PG_FLIP}; INSERT INTO t VALUES (1); SELECT 1 AS y$$`,
	'escape string with an escaped quote': `SELECT E'\\''; ${PG_FLIP}; INSERT INTO t VALUES (1); SELECT ''''`,
	'carriage return ending a line comment': `SELECT 1 -- x\r; ${PG_FLIP}; INSERT INTO t VALUES (1); SELECT '\n'`,
	'nested block comment': `SELECT 1 /* /* */ ' */ ; ${PG_FLIP}; INSERT INTO t VALUES (1); -- '`,
	'non-ASCII dollar-quote tag': `SELECT $é$'$é$; ${PG_FLIP}; INSERT INTO t VALUES (1); SELECT '$é$'`,
	'symmetric escape strings': `SELECT E'\\'' ; ${PG_FLIP} ; INSERT INTO t VALUES (1) ; SELECT E'\\''`,
	'backslash with standard_conforming_strings off': `SELECT '\\'' ; ${PG_FLIP} ; INSERT INTO t VALUES (1) ; SELECT '\\''`,
}

const MYSQL_BYPASSES: Record<string, string> = {
	'$$ is bare identifier chars, not a quote': `SELECT 1 AS $$; ${MY_FLIP}; INSERT INTO t VALUES (1); SELECT 1 AS $$`,
	'backslash-escaped quote in a string': `SELECT '\\''; ${MY_FLIP}; INSERT INTO t VALUES (1); SELECT ''''`,
	'backslash-escaped quote in an identifier string': `SELECT "\\""; ${MY_FLIP}; INSERT INTO t VALUES (1); SELECT """"`,
	'quote inside a backtick identifier': "SELECT 1 AS `'`; " + MY_FLIP + `; INSERT INTO t VALUES (1); SELECT 1 AS \`'\``,
	'# line comment': `SELECT 1 # '\n; ${MY_FLIP}; INSERT INTO t VALUES (1); -- '`,
	'-- without trailing whitespace is not a comment': `SELECT 1 --'';${MY_FLIP};INSERT INTO t VALUES (1);`,
	'backslash under NO_BACKSLASH_ESCAPES': `SELECT '\\' ; ${MY_FLIP} ; INSERT INTO t VALUES (1) ; -- '`,
	'backslash in an identifier under ANSI_QUOTES': `SELECT "\\" ; ${MY_FLIP} ; INSERT INTO t VALUES (1) ; -- "`,
}

describe('isSingleStatement — rejects multi-statement bypasses', () => {
	for (const [name, sql] of Object.entries(POSTGRES_BYPASSES)) {
		test(`postgres: ${name}`, () => {
			expect(isSingleStatement(sql, 'postgresql')).toBe(false)
			// The same string must also be rejected when the dialect is unknown (the openConsole path).
			expect(isSingleStatement(sql, undefined)).toBe(false)
		})
	}
	for (const [name, sql] of Object.entries(MYSQL_BYPASSES)) {
		test(`mysql: ${name}`, () => {
			expect(isSingleStatement(sql, 'mysql')).toBe(false)
			expect(isSingleStatement(sql, undefined)).toBe(false)
		})
	}
})

describe('isSingleStatement — accepts a genuine single statement', () => {
	const singles = [
		'SELECT 1',
		'SELECT 1;',
		'SELECT 1 ; ; ',
		'SELECT 1; -- trailing comment\n',
		'SELECT 42 /* note; still one */',
		"SELECT * FROM users WHERE note = 'a;b' ORDER BY id LIMIT 10",
		"SELECT 'it''s; fine' AS s",
		'SELECT "col;name" FROM t',
		'WITH t AS (SELECT 1) SELECT * FROM t',
	]
	for (const sql of singles) {
		test(JSON.stringify(sql), () => {
			expect(isSingleStatement(sql, 'postgresql')).toBe(true)
			expect(isSingleStatement(sql, 'mysql')).toBe(true)
			expect(isSingleStatement(sql, 'sqlite')).toBe(true)
			expect(isSingleStatement(sql, undefined)).toBe(true)
		})
	}

	test('a Postgres dollar-quoted body carrying a semicolon is one statement', () => {
		expect(isSingleStatement('SELECT $$a;b$$ AS body', 'postgresql')).toBe(true)
		expect(isSingleStatement('SELECT $tag$x;y$tag$ AS body', 'postgresql')).toBe(true)
	})

	test('a backtick identifier carrying a semicolon is one statement (MySQL/SQLite)', () => {
		expect(isSingleStatement('SELECT 1 AS `a;b`', 'mysql')).toBe(true)
		expect(isSingleStatement('SELECT 1 AS `a;b`', 'sqlite')).toBe(true)
	})

	test('a bracket identifier carrying a semicolon is one statement (SQLite)', () => {
		expect(isSingleStatement('SELECT [a;b] FROM t', 'sqlite')).toBe(true)
	})
})

describe('isSingleStatement — rejects plain multi-statement input', () => {
	const multi = ['SELECT 1; SELECT 2', 'SELECT 1; DELETE FROM users', 'SELECT 1;\nUPDATE t SET a = 1']
	for (const sql of multi) {
		test(JSON.stringify(sql), () => {
			expect(isSingleStatement(sql, 'postgresql')).toBe(false)
			expect(isSingleStatement(sql, 'mysql')).toBe(false)
			expect(isSingleStatement(sql, 'sqlite')).toBe(false)
			expect(isSingleStatement(sql, undefined)).toBe(false)
		})
	}

	test('fails closed on an unterminated string', () => {
		expect(isSingleStatement("SELECT 'unterminated", 'postgresql')).toBe(false)
	})

	test('fails closed on an unterminated dollar-quote', () => {
		expect(isSingleStatement('SELECT $$unterminated', 'postgresql')).toBe(false)
	})
})

// `ui.openTable --where` splices the fragment into the grid's `WHERE (…)` in the app's writable
// session, so a separator smuggled past the scan runs as its own statement there.
describe('isWhereFragment', () => {
	test('postgres: a dollar-quoted string cannot hide a separator', () => {
		const where = "$a$'$a$ = $a$x$a$) ; INSERT INTO t VALUES (2) ; SELECT ($a$'$a$"
		expect(isWhereFragment(where, 'postgresql')).toBe(false)
		expect(isWhereFragment(where, undefined)).toBe(false)
	})

	test('mysql: a # comment cannot hide a separator', () => {
		const where = "1=1 #'\n); INSERT INTO t VALUES (2); SELECT (1 #'"
		expect(isWhereFragment(where, 'mysql')).toBe(false)
		expect(isWhereFragment(where, undefined)).toBe(false)
	})

	test('rejects comments, separators, unbalanced parentheses and backslashes in strings', () => {
		const bad = ['id > 1 -- ', 'id > 1 /* x */', 'id > 1 /*! 1 */', 'id > 1; DROP TABLE t', 'id > 1)', '(id > 1', "a = E'\\''"]
		for (const where of bad) {
			expect(isWhereFragment(where, 'postgresql')).toBe(false)
			expect(isWhereFragment(where, 'mysql')).toBe(false)
		}
		expect(isWhereFragment("a = '\\'", 'mysql')).toBe(false)
	})

	test('accepts ordinary boolean filters', () => {
		const good = ["status = 'new'", "name = 'a;b'", 'id > 1 AND (a = 2 OR b = 3)', "note = 'it''s fine'", '"weird;col" = 1']
		for (const where of good) {
			expect(isWhereFragment(where, 'postgresql')).toBe(true)
			expect(isWhereFragment(where, 'mysql')).toBe(true)
			expect(isWhereFragment(where, 'sqlite')).toBe(true)
			expect(isWhereFragment(where, undefined)).toBe(true)
		}
	})
})
