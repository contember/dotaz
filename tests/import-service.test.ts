import { describe, expect, mock, test } from 'bun:test'
import type { DatabaseDriver } from '../src/backend-shared/db/driver'
import { importFromStream, importPreviewFromStream, parseJson } from '../src/backend-shared/services/import-service'
import type { QueryResult } from '../src/shared/types/query'

function stringToStream(content: string): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(content))
			controller.close()
		},
	})
}

function mockDriver(type: 'postgresql' | 'sqlite' = 'postgresql'): DatabaseDriver & {
	importBatchCalls: { table: string; columns: string[]; rows: Record<string, unknown>[] }[]
} {
	const importBatchCalls: { table: string; columns: string[]; rows: Record<string, unknown>[] }[] = []
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`
	let inTx = false

	return {
		importBatchCalls,
		execute: mock(async () => ({ columns: [], rows: [], rowCount: 0, durationMs: 0 })),
		quoteIdentifier,
		getDriverType: () => type,
		qualifyTable: (schema: string, table: string) => {
			if (type === 'sqlite' && schema === 'main') return quoteIdentifier(table)
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
		},
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
		importBatch: mock(async (qualifiedTable: string, columns: string[], rows: Record<string, unknown>[]) => {
			importBatchCalls.push({ table: qualifiedTable, columns, rows })
			return rows.length
		}),
		beginTransaction: mock(async () => {
			inTx = true
		}),
		commit: mock(async () => {
			inTx = false
		}),
		rollback: mock(async () => {
			inTx = false
		}),
		inTransaction: () => inTx,
	} as unknown as DatabaseDriver & {
		importBatchCalls: { table: string; columns: string[]; rows: Record<string, unknown>[] }[]
	}
}

// ── JSON Parsing ───────────────────────────────────────────

describe('parseJson', () => {
	test('parses array of objects', () => {
		const json = JSON.stringify([
			{ name: 'Alice', age: 30 },
			{ name: 'Bob', age: 25 },
		])
		const rows = parseJson(json)

		expect(rows).toHaveLength(2)
		expect(rows[0]).toEqual({ name: 'Alice', age: 30 })
		expect(rows[1]).toEqual({ name: 'Bob', age: 25 })
	})

	test('rejects non-array JSON', () => {
		expect(() => parseJson('{"name": "Alice"}')).toThrow('array of objects')
	})

	test('rejects array with non-object elements', () => {
		expect(() => parseJson('[1, 2, 3]')).toThrow('must be an object')
	})

	test('rejects nested arrays', () => {
		expect(() => parseJson('[[1, 2]]')).toThrow('must be an object')
	})

	test('handles empty array', () => {
		const rows = parseJson('[]')
		expect(rows).toHaveLength(0)
	})

	test('handles null values in objects', () => {
		const json = JSON.stringify([{ name: 'Alice', age: null }])
		const rows = parseJson(json)

		expect(rows[0]).toEqual({ name: 'Alice', age: null })
	})
})

// ── Import Preview (streaming) ─────────────────────────────

describe('importPreviewFromStream', () => {
	test('returns file columns and preview rows from CSV', async () => {
		const csv = 'name,age,email\nAlice,30,a@b.com\nBob,25,b@c.com\nCharlie,35,c@d.com\n'
		const stream = stringToStream(csv)
		const result = await importPreviewFromStream(stream, {
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			limit: 2,
		})

		expect(result.fileColumns).toEqual(['name', 'age', 'email'])
		expect(result.rows).toHaveLength(2)
		// Streaming CSV preview does not know total
		expect(result.totalRows).toBeUndefined()
	})

	test('works with JSON format — returns totalRows', async () => {
		const json = JSON.stringify([
			{ id: 1, name: 'Alice' },
			{ id: 2, name: 'Bob' },
		])
		const stream = stringToStream(json)
		const result = await importPreviewFromStream(stream, {
			format: 'json',
		})

		expect(result.fileColumns).toEqual(['id', 'name'])
		expect(result.totalRows).toBe(2)
	})

	test('does not consume entire stream with maxRows', async () => {
		// Build a large CSV
		const header = 'name,age\n'
		const rows = Array.from({ length: 100 }, (_, i) => `Row${i},${i}`).join('\n')
		const csv = header + rows + '\n'
		const stream = stringToStream(csv)
		const result = await importPreviewFromStream(stream, {
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			limit: 5,
		})

		expect(result.rows).toHaveLength(5)
		expect(result.totalRows).toBeUndefined()
	})
})

// ── Streaming Import ───────────────────────────────────────

describe('importFromStream', () => {
	test('imports CSV data using driver.importBatch()', async () => {
		const driver = mockDriver()
		const csv = 'name,age\nAlice,30\nBob,25\n'
		const stream = stringToStream(csv)

		const result = await importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [
				{ fileColumn: 'name', tableColumn: 'name' },
				{ fileColumn: 'age', tableColumn: 'age' },
			],
		})

		expect(result.rowCount).toBe(2)
		expect(driver.beginTransaction).toHaveBeenCalled()
		expect(driver.commit).toHaveBeenCalled()
		expect(driver.importBatchCalls).toHaveLength(1)
		expect(driver.importBatchCalls[0].table).toBe('"public"."users"')
		expect(driver.importBatchCalls[0].columns).toEqual(['name', 'age'])
		expect(driver.importBatchCalls[0].rows).toEqual([
			{ name: 'Alice', age: 30 },
			{ name: 'Bob', age: 25 },
		])
	})

	test('skips columns with null tableColumn', async () => {
		const driver = mockDriver()
		const csv = 'name,skip_me,age\nAlice,xxx,30\n'
		const stream = stringToStream(csv)

		const result = await importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [
				{ fileColumn: 'name', tableColumn: 'name' },
				{ fileColumn: 'skip_me', tableColumn: null },
				{ fileColumn: 'age', tableColumn: 'age' },
			],
		})

		expect(result.rowCount).toBe(1)
		expect(driver.importBatchCalls[0].columns).toEqual(['name', 'age'])
		expect(driver.importBatchCalls[0].rows).toEqual([
			{ name: 'Alice', age: 30 },
		])
	})

	test('throws when no columns are mapped', async () => {
		const driver = mockDriver()
		const stream = stringToStream('a,b\n1,2\n')

		await expect(importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [
				{ fileColumn: 'a', tableColumn: null },
				{ fileColumn: 'b', tableColumn: null },
			],
		})).rejects.toThrow('No columns mapped')
	})

	test('handles JSON import', async () => {
		const driver = mockDriver()
		const json = JSON.stringify([
			{ name: 'Alice', email: 'alice@test.com' },
			{ name: 'Bob', email: 'bob@test.com' },
		])
		const stream = stringToStream(json)

		const result = await importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'json',
			mappings: [
				{ fileColumn: 'name', tableColumn: 'name' },
				{ fileColumn: 'email', tableColumn: 'email' },
			],
		})

		expect(result.rowCount).toBe(2)
		expect(driver.importBatchCalls[0].rows).toEqual([
			{ name: 'Alice', email: 'alice@test.com' },
			{ name: 'Bob', email: 'bob@test.com' },
		])
	})

	test('batches importBatch calls', async () => {
		const driver = mockDriver()
		const rows = Array.from({ length: 5 }, (_, i) => `Row${i},${i}`).join('\n')
		const csv = `name,val\n${rows}\n`
		const stream = stringToStream(csv)

		await importFromStream(driver, stream, {
			schema: 'public',
			table: 't',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [
				{ fileColumn: 'name', tableColumn: 'name' },
				{ fileColumn: 'val', tableColumn: 'val' },
			],
			batchSize: 2,
		})

		// 5 rows with batchSize 2 → 3 importBatch calls (2, 2, 1)
		expect(driver.importBatchCalls).toHaveLength(3)
		expect(driver.importBatchCalls[0].rows).toHaveLength(2)
		expect(driver.importBatchCalls[1].rows).toHaveLength(2)
		expect(driver.importBatchCalls[2].rows).toHaveLength(1)
	})

	test('rolls back on DB error', async () => {
		const driver = mockDriver()
		;(driver as any).importBatch.mockImplementation(async () => {
			throw new Error('constraint violation')
		})

		const stream = stringToStream('name\nAlice\n')

		await expect(importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [{ fileColumn: 'name', tableColumn: 'name' }],
		})).rejects.toThrow('constraint violation')

		expect(driver.beginTransaction).toHaveBeenCalled()
		expect(driver.rollback).toHaveBeenCalled()
		expect(driver.commit).not.toHaveBeenCalled()
	})

	test('rolls back on parse error', async () => {
		const driver = mockDriver()

		// CSV with unclosed quote triggers a parse error
		const csv = 'name\n"unclosed quote\n'
		const stream = stringToStream(csv)

		await expect(importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [{ fileColumn: 'name', tableColumn: 'name' }],
		})).rejects.toThrow(/parse error.*line/i)

		expect(driver.beginTransaction).toHaveBeenCalled()
		expect(driver.rollback).toHaveBeenCalled()
		expect(driver.commit).not.toHaveBeenCalled()
	})

	test('rolls back on cancellation via AbortSignal', async () => {
		const driver = mockDriver()
		const ac = new AbortController()

		// Large CSV — abort before processing starts
		const header = 'name,val\n'
		const rows = Array.from({ length: 100 }, (_, i) => `Row${i},${i}`).join('\n')
		const csv = header + rows + '\n'

		// Abort immediately so the signal is already aborted when the loop checks
		ac.abort()

		const stream = stringToStream(csv)

		await expect(importFromStream(driver, stream, {
			schema: 'public',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [
				{ fileColumn: 'name', tableColumn: 'name' },
				{ fileColumn: 'val', tableColumn: 'val' },
			],
			batchSize: 2,
		}, ac.signal)).rejects.toThrow('Import cancelled')

		expect(driver.rollback).toHaveBeenCalled()
		expect(driver.commit).not.toHaveBeenCalled()
	})

	test('reports progress via onProgress callback', async () => {
		const driver = mockDriver()
		const csv = 'name\nAlice\nBob\nCharlie\n'
		const stream = stringToStream(csv)
		const progressValues: number[] = []

		await importFromStream(
			driver,
			stream,
			{
				schema: 'public',
				table: 'users',
				format: 'csv',
				delimiter: ',',
				hasHeader: true,
				mappings: [{ fileColumn: 'name', tableColumn: 'name' }],
				batchSize: 1,
			},
			undefined,
			(count) => progressValues.push(count),
		)

		expect(progressValues).toEqual([1, 2, 3])
	})

	test('uses correct table qualification for SQLite', async () => {
		const driver = mockDriver('sqlite')
		const csv = 'name\nAlice\n'
		const stream = stringToStream(csv)

		await importFromStream(driver, stream, {
			schema: 'main',
			table: 'users',
			format: 'csv',
			delimiter: ',',
			hasHeader: true,
			mappings: [{ fileColumn: 'name', tableColumn: 'name' }],
		})

		expect(driver.importBatchCalls[0].table).toBe('"users"')
	})
})
