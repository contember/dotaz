import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DatabaseDriver } from '../src/backend-shared/db/driver'
import { createHandlers } from '../src/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '../src/backend-shared/services/connection-manager'
import {
	generateChangePreview,
	generateChangesPreview,
	generateChangeSql,
	generateDelete,
	generateInsert,
	generateUpdate,
} from '../src/backend-shared/services/query-executor'
import { AppDatabase } from '../src/backend-shared/storage/app-db'
import type { SqliteConnectionConfig } from '../src/shared/types/connection'
import { isSqlDefault, SQL_DEFAULT } from '../src/shared/types/database'
import type { DataChange, DeleteChange, InsertChange, UpdateChange } from '../src/shared/types/rpc'

// ── Helpers ──────────────────────────────────────────────────

const sqliteConfig: SqliteConnectionConfig = {
	type: 'sqlite',
	path: ':memory:',
}

function setup() {
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	const cm = new ConnectionManager(appDb)
	const { handlers } = createHandlers(cm, undefined, appDb)
	return { appDb, cm, handlers }
}

// ── SQL Generation Unit Tests ────────────────────────────────

describe('SQL Generation', () => {
	let cm: ConnectionManager
	let driver: DatabaseDriver
	let connectionId: string

	beforeEach(async () => {
		const { cm: mgr, handlers } = setup()
		cm = mgr
		const conn = handlers['connections.create']({
			name: 'SQLite Test',
			config: sqliteConfig,
		})
		connectionId = conn.id
		await handlers['connections.connect']({ connectionId })
		driver = cm.getDriver(connectionId)
	})

	afterEach(async () => {
		await cm.disconnectAll()
		AppDatabase.resetInstance()
	})

	describe('generateInsert', () => {
		test('generates INSERT with correct columns and params', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Alice', age: 30 },
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)')
			expect(result.params).toEqual(['Alice', 30])
		})

		test('handles NULL values in INSERT', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Bob', age: null },
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)')
			expect(result.params).toEqual(['Bob', null])
		})

		test('generates DEFAULT VALUES if no values provided', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" DEFAULT VALUES')
			expect(result.params).toEqual([])
		})

		test('generates DEFAULT VALUES if values is empty', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: {},
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" DEFAULT VALUES')
			expect(result.params).toEqual([])
		})
	})

	describe('generateUpdate', () => {
		test('generates UPDATE with SET and WHERE clauses', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { name: 'Alice Updated', age: 31 },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe(
				'UPDATE "users" SET "name" = $1, "age" = $2 WHERE "id" = $3',
			)
			expect(result.params).toEqual(['Alice Updated', 31, 1])
		})

		test('updates only modified columns', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { age: 35 },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe('UPDATE "users" SET "age" = $1 WHERE "id" = $2')
			expect(result.params).toEqual([35, 1])
		})

		test('handles composite primary key', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'user_roles',
				primaryKeys: { user_id: 1, role_id: 2 },
				values: { active: true },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe(
				'UPDATE "user_roles" SET "active" = $1 WHERE "user_id" = $2 AND "role_id" = $3',
			)
			expect(result.params).toEqual([true, 1, 2])
		})

		test('handles SET NULL', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { age: null },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe('UPDATE "users" SET "age" = $1 WHERE "id" = $2')
			expect(result.params).toEqual([null, 1])
		})

		// Note: "throws if no primaryKeys" and "throws if no values" tests removed —
		// these are now compile-time errors enforced by the UpdateChange type.
	})

	describe('generateDelete', () => {
		test('generates DELETE with PK WHERE clause', () => {
			const change: DeleteChange = {
				type: 'delete',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
			}
			const result = generateDelete(change, driver)
			expect(result.sql).toBe('DELETE FROM "users" WHERE "id" = $1')
			expect(result.params).toEqual([1])
		})

		test('handles composite primary key', () => {
			const change: DeleteChange = {
				type: 'delete',
				schema: 'main',
				table: 'user_roles',
				primaryKeys: { user_id: 1, role_id: 2 },
			}
			const result = generateDelete(change, driver)
			expect(result.sql).toBe(
				'DELETE FROM "user_roles" WHERE "user_id" = $1 AND "role_id" = $2',
			)
			expect(result.params).toEqual([1, 2])
		})

		// Note: "throws if no primaryKeys" test removed —
		// now a compile-time error enforced by the DeleteChange type.
	})

	describe('generateChangeSql', () => {
		test('dispatches to insert', () => {
			const change: DataChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Test' },
			}
			const result = generateChangeSql(change, driver)
			expect(result.sql).toContain('INSERT INTO')
		})

		test('dispatches to update', () => {
			const change: DataChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { name: 'Test' },
			}
			const result = generateChangeSql(change, driver)
			expect(result.sql).toContain('UPDATE')
		})

		test('dispatches to delete', () => {
			const change: DataChange = {
				type: 'delete',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
			}
			const result = generateChangeSql(change, driver)
			expect(result.sql).toContain('DELETE FROM')
		})
	})

	describe('generateChangePreview', () => {
		test('INSERT preview has inlined values', () => {
			const change: DataChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Alice', age: 30 },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toBe(`INSERT INTO "users" ("name", "age") VALUES ('Alice', 30);`)
		})

		test('INSERT preview handles NULL', () => {
			const change: DataChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Bob', age: null },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toContain('NULL')
		})

		test('UPDATE preview shows SET and WHERE', () => {
			const change: DataChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { name: 'Updated' },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toBe(`UPDATE "users" SET "name" = 'Updated' WHERE "id" = 1;`)
		})

		test('DELETE preview shows WHERE', () => {
			const change: DataChange = {
				type: 'delete',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 5 },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toBe(`DELETE FROM "users" WHERE "id" = 5;`)
		})

		test('preview escapes single quotes in strings', () => {
			const change: DataChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: "O'Brien" },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toContain("'O''Brien'")
		})
	})

	describe('generateChangesPreview', () => {
		test('combines multiple changes with newlines', () => {
			const changes: DataChange[] = [
				{ type: 'insert', schema: 'main', table: 'users', values: { name: 'New' } },
				{ type: 'update', schema: 'main', table: 'users', primaryKeys: { id: 1 }, values: { name: 'Upd' } },
				{ type: 'delete', schema: 'main', table: 'users', primaryKeys: { id: 2 } },
			]
			const result = generateChangesPreview(changes, driver)
			const lines = result.split('\n')
			expect(lines).toHaveLength(3)
			expect(lines[0]).toContain('INSERT INTO')
			expect(lines[1]).toContain('UPDATE')
			expect(lines[2]).toContain('DELETE FROM')
		})
	})

	describe('SQL_DEFAULT sentinel', () => {
		test('isSqlDefault identifies the sentinel', () => {
			expect(isSqlDefault(SQL_DEFAULT)).toBe(true)
			expect(isSqlDefault(null)).toBe(false)
			expect(isSqlDefault('DEFAULT')).toBe(false)
			expect(isSqlDefault(42)).toBe(false)
			expect(isSqlDefault({ __dotaz_sentinel: 'OTHER' })).toBe(false)
		})

		test('INSERT with SQL_DEFAULT uses DEFAULT keyword', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Alice', age: SQL_DEFAULT },
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, DEFAULT)')
			expect(result.params).toEqual(['Alice'])
		})

		test('INSERT with all SQL_DEFAULT values uses DEFAULT for each', () => {
			const change: InsertChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: SQL_DEFAULT, age: SQL_DEFAULT },
			}
			const result = generateInsert(change, driver)
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES (DEFAULT, DEFAULT)')
			expect(result.params).toEqual([])
		})

		test('UPDATE with SQL_DEFAULT uses DEFAULT keyword', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { name: 'Alice', age: SQL_DEFAULT },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe(
				'UPDATE "users" SET "name" = $1, "age" = DEFAULT WHERE "id" = $2',
			)
			expect(result.params).toEqual(['Alice', 1])
		})

		test('UPDATE with only SQL_DEFAULT values', () => {
			const change: UpdateChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { age: SQL_DEFAULT },
			}
			const result = generateUpdate(change, driver)
			expect(result.sql).toBe(
				'UPDATE "users" SET "age" = DEFAULT WHERE "id" = $1',
			)
			expect(result.params).toEqual([1])
		})

		test('INSERT preview shows DEFAULT for sentinel values', () => {
			const change: DataChange = {
				type: 'insert',
				schema: 'main',
				table: 'users',
				values: { name: 'Alice', age: SQL_DEFAULT },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toBe(`INSERT INTO "users" ("name", "age") VALUES ('Alice', DEFAULT);`)
		})

		test('UPDATE preview shows DEFAULT for sentinel values', () => {
			const change: DataChange = {
				type: 'update',
				schema: 'main',
				table: 'users',
				primaryKeys: { id: 1 },
				values: { age: SQL_DEFAULT },
			}
			const result = generateChangePreview(change, driver)
			expect(result).toBe(`UPDATE "users" SET "age" = DEFAULT WHERE "id" = 1;`)
		})
	})
})
