/**
 * Statement classification — pure unit tests, no database needed.
 *
 * Run: bun test tests/statement-classification.test.ts
 */
import { classifyStatement, isReadOnlySql } from '@dotaz/shared/sql/statements'
import { describe, expect, test } from 'bun:test'

describe('classifyStatement — reads', () => {
	test('SELECT', () => {
		expect(classifyStatement('SELECT * FROM users')).toBe('read')
		expect(classifyStatement('  select 1  ')).toBe('read')
	})

	test('WITH ... SELECT', () => {
		expect(classifyStatement('WITH t AS (SELECT 1 AS n) SELECT * FROM t')).toBe('read')
		expect(classifyStatement('WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t) SELECT n FROM t')).toBe('read')
	})

	test('parenthesised compound SELECT', () => {
		expect(classifyStatement('(SELECT 1) UNION (SELECT 2)')).toBe('read')
	})

	test('SHOW / DESCRIBE / DESC', () => {
		expect(classifyStatement('SHOW search_path')).toBe('read')
		expect(classifyStatement('DESCRIBE users')).toBe('read')
		expect(classifyStatement('DESC users')).toBe('read')
	})

	test('VALUES and TABLE', () => {
		expect(classifyStatement('VALUES (1), (2)')).toBe('read')
		expect(classifyStatement('TABLE users')).toBe('read')
	})

	test('PRAGMA read', () => {
		expect(classifyStatement('PRAGMA table_info(users)')).toBe('read')
		expect(classifyStatement('PRAGMA query_only')).toBe('read')
	})

	test('PRAGMA assignment is not provably a read', () => {
		expect(classifyStatement('PRAGMA query_only = ON')).toBe('unknown')
		expect(classifyStatement('PRAGMA user_version = 4')).toBe('unknown')
	})
})

describe('classifyStatement — EXPLAIN', () => {
	test('plain EXPLAIN never executes the statement', () => {
		expect(classifyStatement('EXPLAIN SELECT * FROM users')).toBe('read')
		expect(classifyStatement('EXPLAIN INSERT INTO users (name) VALUES (1)')).toBe('read')
		expect(classifyStatement('EXPLAIN QUERY PLAN SELECT * FROM users')).toBe('read')
		expect(classifyStatement('EXPLAIN FORMAT=JSON SELECT * FROM users')).toBe('read')
	})

	test('EXPLAIN ANALYZE takes the kind of the statement it runs', () => {
		expect(classifyStatement('EXPLAIN ANALYZE SELECT * FROM users')).toBe('read')
		expect(classifyStatement('EXPLAIN ANALYZE INSERT INTO users (name) VALUES (1)')).toBe('write')
		expect(classifyStatement('EXPLAIN ANALYZE DELETE FROM users')).toBe('write')
		expect(classifyStatement('EXPLAIN ANALYZE VERBOSE UPDATE users SET name = 1')).toBe('write')
	})

	test('EXPLAIN with a parenthesised option list', () => {
		expect(classifyStatement('EXPLAIN (FORMAT JSON) SELECT 1')).toBe('read')
		expect(classifyStatement('EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1')).toBe('read')
		expect(classifyStatement('EXPLAIN (ANALYZE, FORMAT JSON) UPDATE users SET name = 1')).toBe('write')
		expect(classifyStatement('EXPLAIN (ANALYZE FALSE) DELETE FROM users')).toBe('read')
	})
})

describe('classifyStatement — writes', () => {
	test('plain DML', () => {
		expect(classifyStatement('INSERT INTO users (name) VALUES (1)')).toBe('write')
		expect(classifyStatement('UPDATE users SET name = 1')).toBe('write')
		expect(classifyStatement('DELETE FROM users')).toBe('write')
		expect(classifyStatement('REPLACE INTO users (id) VALUES (1)')).toBe('write')
		expect(classifyStatement('TRUNCATE users')).toBe('write')
		expect(classifyStatement('MERGE INTO users USING staged ON (users.id = staged.id)')).toBe('write')
	})

	test('procedure invocation', () => {
		expect(classifyStatement('CALL do_the_thing()')).toBe('write')
		expect(classifyStatement('DO $$ BEGIN PERFORM 1; END $$')).toBe('write')
	})

	test('COPY ... FROM loads data', () => {
		expect(classifyStatement("COPY users FROM '/tmp/users.csv'")).toBe('write')
	})

	test('data-modifying CTEs are classified by their tail', () => {
		expect(classifyStatement('WITH deleted AS (SELECT id FROM stale) DELETE FROM users WHERE id IN (SELECT id FROM deleted)')).toBe('write')
		expect(classifyStatement('WITH t AS (SELECT 1 AS n) INSERT INTO users (id) SELECT n FROM t')).toBe('write')
		expect(classifyStatement('WITH t AS (SELECT 1 AS n) UPDATE users SET id = (SELECT n FROM t)')).toBe('write')
		expect(classifyStatement('WITH a AS (SELECT 1), b AS (SELECT 2) DELETE FROM users')).toBe('write')
	})

	test('a SELECT nested inside a CTE body does not make the statement a read', () => {
		expect(classifyStatement('WITH t AS (SELECT id FROM users WHERE id IN (SELECT id FROM other)) DELETE FROM users')).toBe('write')
	})
})

describe('classifyStatement — DDL', () => {
	test('schema changes', () => {
		expect(classifyStatement('CREATE TABLE t (id INTEGER)')).toBe('ddl')
		expect(classifyStatement('ALTER TABLE t ADD COLUMN x INTEGER')).toBe('ddl')
		expect(classifyStatement('DROP TABLE t')).toBe('ddl')
		expect(classifyStatement('CREATE INDEX idx ON t (id)')).toBe('ddl')
	})

	test('privileges and maintenance', () => {
		expect(classifyStatement('GRANT SELECT ON users TO alice')).toBe('ddl')
		expect(classifyStatement('REVOKE SELECT ON users FROM alice')).toBe('ddl')
		expect(classifyStatement('VACUUM')).toBe('ddl')
		expect(classifyStatement('REINDEX users')).toBe('ddl')
		expect(classifyStatement("ATTACH DATABASE '/tmp/other.db' AS other")).toBe('ddl')
		expect(classifyStatement('DETACH DATABASE other')).toBe('ddl')
	})
})

describe('classifyStatement — unknown', () => {
	test('empty and comment-only input', () => {
		expect(classifyStatement('')).toBe('unknown')
		expect(classifyStatement('   ')).toBe('unknown')
		expect(classifyStatement('-- just a comment')).toBe('unknown')
		expect(classifyStatement('/* block */')).toBe('unknown')
	})

	test('session state and transaction control are not provable reads', () => {
		expect(classifyStatement('SET search_path TO public')).toBe('unknown')
		expect(classifyStatement('BEGIN')).toBe('unknown')
		expect(classifyStatement('COMMIT')).toBe('unknown')
		expect(classifyStatement('ANALYZE')).toBe('unknown')
	})

	test('COPY ... TO is not a database read', () => {
		expect(classifyStatement("COPY users TO '/tmp/users.csv'")).toBe('unknown')
	})
})

describe('classifyStatement — literals and comments', () => {
	test('keywords inside string literals do not count', () => {
		expect(classifyStatement("SELECT 'DELETE FROM users' AS sql")).toBe('read')
		expect(classifyStatement(`SELECT 'it''s an INSERT' AS note`)).toBe('read')
		expect(classifyStatement('SELECT $$ DROP TABLE users $$ AS body')).toBe('read')
	})

	test('keywords inside quoted identifiers do not count', () => {
		expect(classifyStatement('SELECT "insert" FROM "update"')).toBe('read')
	})

	test('leading comments do not hide the operation', () => {
		expect(classifyStatement('-- read the users\nSELECT * FROM users')).toBe('read')
		expect(classifyStatement('/* audit */ DELETE FROM users')).toBe('write')
		expect(classifyStatement('/* SELECT */ UPDATE users SET name = 1')).toBe('write')
	})
})

describe('isReadOnlySql', () => {
	test('true only when every statement reads', () => {
		expect(isReadOnlySql('SELECT 1')).toBe(true)
		expect(isReadOnlySql('SELECT 1; SELECT 2;')).toBe(true)
		expect(isReadOnlySql('SELECT 1; DELETE FROM users;')).toBe(false)
		expect(isReadOnlySql('DELETE FROM users; SELECT 1')).toBe(false)
	})

	test('trailing semicolons and whitespace are ignored', () => {
		expect(isReadOnlySql('  SELECT 1 ;  ')).toBe(true)
	})

	test('fails closed on unknown and empty input', () => {
		expect(isReadOnlySql('')).toBe(false)
		expect(isReadOnlySql('   ')).toBe(false)
		expect(isReadOnlySql('-- nothing here')).toBe(false)
		expect(isReadOnlySql('SELECT 1; SET search_path TO public')).toBe(false)
	})

	test('a write hidden behind a CTE is still a write', () => {
		expect(isReadOnlySql('WITH t AS (SELECT 1 AS n) INSERT INTO users (id) SELECT n FROM t')).toBe(false)
	})

	test('a semicolon inside a literal does not split the statement', () => {
		expect(isReadOnlySql("SELECT 'a;DELETE FROM users' AS s")).toBe(true)
	})
})
