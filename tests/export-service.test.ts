import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { buildExportSelectQuery, exportPreview, exportToFile, exportToStream } from '@dotaz/backend-shared/services/export-service'
import type { ExportParams, ExportWriter } from '@dotaz/backend-shared/services/export-service'
import type { QueryResult } from '@dotaz/shared/types/query'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeResult(rows: Record<string, unknown>[]): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: 'unknown' }))
		: []
	return { columns, rows, rowCount: rows.length, durationMs: 0 }
}

/**
 * Create a mock driver that uses iterate() to yield rows in a single batch.
 * Also supports execute() for preview queries.
 */
function mockDriver(
	rows: Record<string, unknown>[],
	type: 'postgresql' | 'sqlite' = 'postgresql',
): DatabaseDriver {
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`
	return {
		execute: mock(async () => makeResult(rows)),
		iterate: mock(async function*(_sql: string, _params?: unknown[], _batchSize?: number, _signal?: AbortSignal) {
			if (rows.length > 0) yield rows
		}),
		quoteIdentifier,
		getDriverType: () => type,
		qualifyTable: (schema: string, table: string) => {
			if (type === 'sqlite' && schema === 'main') return quoteIdentifier(table)
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
		},
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
	} as unknown as DatabaseDriver
}

/**
 * Create a mock driver that yields rows across multiple batches via iterate().
 */
function mockDriverMultiBatch(
	batches: Record<string, unknown>[][],
	type: 'postgresql' | 'sqlite' = 'postgresql',
): DatabaseDriver {
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`
	return {
		execute: mock(async () => makeResult(batches.flat())),
		iterate: mock(async function*(_sql: string, _params?: unknown[], _batchSize?: number, _signal?: AbortSignal) {
			for (const batch of batches) {
				yield batch
			}
		}),
		quoteIdentifier,
		getDriverType: () => type,
		qualifyTable: (schema: string, table: string) => {
			if (type === 'sqlite' && schema === 'main') return quoteIdentifier(table)
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
		},
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
	} as unknown as DatabaseDriver
}

/** Collect all written chunks into a buffer for testing exportToStream(). */
function createBufferWriter(): ExportWriter & { chunks: (string | Uint8Array)[] } {
	const chunks: (string | Uint8Array)[] = []
	return {
		chunks,
		write(chunk: string | Uint8Array) {
			chunks.push(chunk)
		},
		async end() {},
	}
}

/** Concatenate buffer writer chunks into a string. */
function collectString(writer: { chunks: (string | Uint8Array)[] }): string {
	return writer.chunks.map((c) => typeof c === 'string' ? c : new TextDecoder().decode(c)).join('')
}

const sampleRows = [
	{ id: 1, name: 'Alice', age: 30 },
	{ id: 2, name: 'Bob', age: 25 },
	{ id: 3, name: 'Charlie', age: null },
]

const baseParams: ExportParams = {
	schema: 'public',
	table: 'users',
	format: 'csv',
}

let tmpDir: string

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'dotaz-export-'))
})

afterEach(() => {
	// Clean up temp files
	try {
		const files = new Bun.Glob('*').scanSync(tmpDir)
		for (const f of files) {
			unlinkSync(join(tmpDir, f))
		}
		rmdirSync(tmpDir)
	} catch { /* ignore cleanup errors */ }
})

// ── buildExportSelectQuery ─────────────────────────────────

describe('buildExportSelectQuery', () => {
	test('generates SELECT without LIMIT/OFFSET', () => {
		const driver = mockDriver(sampleRows)
		const { sql, params } = buildExportSelectQuery(baseParams, driver)

		expect(sql).toBe('SELECT * FROM "public"."users"')
		expect(sql).not.toContain('LIMIT')
		expect(sql).not.toContain('OFFSET')
		expect(params).toEqual([])
	})

	test('includes columns when specified', () => {
		const driver = mockDriver(sampleRows)
		const { sql } = buildExportSelectQuery({ ...baseParams, columns: ['id', 'name'] }, driver)

		expect(sql).toContain('"id", "name"')
		expect(sql).not.toContain('*')
	})

	test('includes WHERE clause for filters', () => {
		const driver = mockDriver(sampleRows)
		const { sql, params } = buildExportSelectQuery({
			...baseParams,
			filters: [{ column: 'age', operator: 'gt', value: 20 }],
		}, driver)

		expect(sql).toContain('WHERE')
		expect(sql).toContain('"age" > $1')
		expect(params).toEqual([20])
	})

	test('includes ORDER BY for sort', () => {
		const driver = mockDriver(sampleRows)
		const { sql } = buildExportSelectQuery({
			...baseParams,
			sort: [{ column: 'name', direction: 'asc' }],
		}, driver)

		expect(sql).toContain('ORDER BY "name" ASC')
	})
})

// ── exportToStream ─────────────────────────────────────────

describe('exportToStream', () => {
	test('uses driver.iterate() instead of execute()', async () => {
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		await exportToStream(driver, { ...baseParams, format: 'csv' }, writer)

		expect(driver.iterate).toHaveBeenCalledTimes(1)
		expect(driver.execute).not.toHaveBeenCalled()
	})

	test('passes signal to driver.iterate()', async () => {
		const controller = new AbortController()
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		await exportToStream(driver, { ...baseParams, format: 'csv' }, writer, controller.signal)

		const callArgs = (driver.iterate as any).mock.calls[0]
		expect(callArgs[3]).toBe(controller.signal)
	})

	test('reports progress after each batch', async () => {
		const batch1 = [{ id: 1 }, { id: 2 }]
		const batch2 = [{ id: 3 }]
		const driver = mockDriverMultiBatch([batch1, batch2])
		const writer = createBufferWriter()
		const progressCalls: number[] = []

		await exportToStream(driver, { ...baseParams, format: 'csv' }, writer, undefined, (count) => {
			progressCalls.push(count)
		})

		expect(progressCalls).toEqual([2, 3])
	})

	test('returns cumulative row count', async () => {
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		const result = await exportToStream(driver, { ...baseParams, format: 'csv' }, writer)

		expect(result.rowCount).toBe(3)
	})

	test('respects limit by truncating iteration', async () => {
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		const result = await exportToStream(driver, { ...baseParams, format: 'csv', limit: 2 }, writer)

		expect(result.rowCount).toBe(2)
		const content = collectString(writer)
		const lines = content.trim().split('\n')
		// header + 2 data rows
		expect(lines).toHaveLength(3)
	})

	test('supports async writer for backpressure', async () => {
		const driver = mockDriver(sampleRows)
		const chunks: string[] = []
		const writer: ExportWriter = {
			async write(chunk) {
				// Simulate async backpressure
				await new Promise((r) => setTimeout(r, 1))
				chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
			},
			async end() {},
		}

		const result = await exportToStream(driver, { ...baseParams, format: 'csv' }, writer)

		expect(result.rowCount).toBe(3)
		expect(chunks.length).toBeGreaterThan(0)
	})

	test('CSV output matches expected format', async () => {
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		await exportToStream(driver, { ...baseParams, format: 'csv' }, writer)

		const content = collectString(writer)
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('id,name,age')
		expect(lines[1]).toBe('1,Alice,30')
		expect(lines[2]).toBe('2,Bob,25')
		expect(lines[3]).toBe('3,Charlie,')
	})

	test('JSON output is valid', async () => {
		const driver = mockDriver(sampleRows)
		const writer = createBufferWriter()

		await exportToStream(driver, { ...baseParams, format: 'json' }, writer)

		const content = collectString(writer)
		const parsed = JSON.parse(content)
		expect(parsed).toHaveLength(3)
		expect(parsed[0]).toEqual({ id: 1, name: 'Alice', age: 30 })
	})

	test('all export formats work', async () => {
		const formats = ['csv', 'json', 'sql', 'sql_update', 'markdown', 'html', 'xml'] as const

		for (const format of formats) {
			const driver = mockDriver(sampleRows)
			const writer = createBufferWriter()

			const result = await exportToStream(driver, { ...baseParams, format }, writer)
			const content = collectString(writer)

			expect(result.rowCount).toBe(3)
			expect(content.length).toBeGreaterThan(0)
		}
	})
})

// ── CSV Export (file) ──────────────────────────────────────

describe('CSV export', () => {
	test('generates valid CSV with headers (comma delimiter)', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		const result = await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		expect(result.rowCount).toBe(3)
		expect(result.sizeBytes).toBeGreaterThan(0)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('id,name,age')
		expect(lines[1]).toBe('1,Alice,30')
		expect(lines[2]).toBe('2,Bob,25')
		expect(lines[3]).toBe('3,Charlie,')
	})

	test('semicolon delimiter', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv', delimiter: ';' }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('id;name;age')
		expect(lines[1]).toBe('1;Alice;30')
	})

	test('tab delimiter', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv', delimiter: '\t' }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('id\tname\tage')
		expect(lines[1]).toBe('1\tAlice\t30')
	})

	test('without headers', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv', includeHeaders: false }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('1,Alice,30')
		expect(lines).toHaveLength(3)
	})

	test('escapes fields containing delimiter', async () => {
		const rows = [{ id: 1, name: 'Smith, John', age: 30 }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[1]).toBe('1,"Smith, John",30')
	})

	test('escapes fields containing double quotes', async () => {
		const rows = [{ id: 1, name: 'He said "hello"', age: 30 }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[1]).toBe('1,"He said ""hello""",30')
	})

	test('escapes fields containing newlines', async () => {
		const rows = [{ id: 1, name: 'Line1\nLine2', age: 30 }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('"Line1\nLine2"')
	})

	test('null values exported as empty string', async () => {
		const rows = [{ id: 1, name: null }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[1]).toBe('1,')
	})
})

// ── CSV Encoding ──────────────────────────────────────────

describe('CSV encoding', () => {
	test('default encoding is UTF-8', async () => {
		const rows = [{ id: 1, name: 'Ñoño' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		// UTF-8 encoding of Ñ is 0xC3 0x91
		const content = new TextDecoder('utf-8').decode(bytes)
		expect(content).toContain('Ñoño')
	})

	test('UTF-8 with BOM', async () => {
		const rows = [{ id: 1, name: 'Alice' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'utf-8',
			utf8Bom: true,
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		// BOM bytes: 0xEF 0xBB 0xBF
		expect(bytes[0]).toBe(0xEF)
		expect(bytes[1]).toBe(0xBB)
		expect(bytes[2]).toBe(0xBF)
	})

	test('UTF-8 without BOM by default', async () => {
		const rows = [{ id: 1, name: 'Alice' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'utf-8',
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		// No BOM — first byte should be 'i' (from "id" header)
		expect(bytes[0]).toBe(0x69) // 'i'
	})

	test('ISO-8859-1 encoding for Latin characters', async () => {
		const rows = [{ id: 1, name: 'café' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'iso-8859-1',
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		const content = new TextDecoder('iso-8859-1').decode(bytes)
		expect(content).toContain('café')
		// Verify é is encoded as single byte 0xE9 in ISO-8859-1
		const dataLine = content.split('\n')[1]
		expect(dataLine).toBe('1,café')
	})

	test('Windows-1252 encoding with special characters', async () => {
		// € is U+20AC, which maps to 0x80 in Windows-1252
		const rows = [{ id: 1, price: '€100' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'windows-1252',
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		const content = new TextDecoder('windows-1252').decode(bytes)
		expect(content).toContain('€100')
	})

	test('ISO-8859-1 replaces unmappable characters with ?', async () => {
		// € (U+20AC) cannot be represented in ISO-8859-1
		const rows = [{ id: 1, price: '€50' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'iso-8859-1',
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		const content = new TextDecoder('iso-8859-1').decode(bytes)
		expect(content).toContain('?50')
	})

	test('BOM is not included for non-UTF-8 encodings', async () => {
		const rows = [{ id: 1, name: 'test' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			encoding: 'iso-8859-1',
			utf8Bom: true,
		}, filePath)

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
		// Should NOT start with BOM
		expect(bytes[0]).not.toBe(0xEF)
	})
})

// ── JSON Export ────────────────────────────────────────────

describe('JSON export', () => {
	test('generates valid JSON array', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.json')

		const result = await exportToFile(driver, { ...baseParams, format: 'json' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		const parsed = JSON.parse(content)
		expect(parsed).toBeArray()
		expect(parsed).toHaveLength(3)
		expect(parsed[0]).toEqual({ id: 1, name: 'Alice', age: 30 })
		expect(parsed[2]).toEqual({ id: 3, name: 'Charlie', age: null })
	})

	test('generates valid JSON for empty result', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.json')

		await exportToFile(driver, { ...baseParams, format: 'json' }, filePath)

		const content = await Bun.file(filePath).text()
		const parsed = JSON.parse(content)
		expect(parsed).toEqual([])
	})

	test('pretty prints with indentation', async () => {
		const rows = [{ id: 1 }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.json')

		await exportToFile(driver, { ...baseParams, format: 'json' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('[\n')
		expect(content).toContain('  ')
	})
})

// ── SQL INSERT Export ──────────────────────────────────────

describe('SQL INSERT export', () => {
	test('generates valid INSERT statements', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.sql')

		const result = await exportToFile(driver, { ...baseParams, format: 'sql' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		expect(content).toContain('INSERT INTO "public"."users"')
		expect(content).toContain("'Alice'")
		expect(content).toContain("'Bob'")
		expect(content).toContain('NULL')
	})

	test('batches INSERT statements according to batchSize', async () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `User${i + 1}` }))
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql', batchSize: 2 }, filePath)

		const content = await Bun.file(filePath).text()
		const insertCount = (content.match(/INSERT INTO/g) || []).length
		expect(insertCount).toBe(3) // 2 + 2 + 1
	})

	test('escapes single quotes in values', async () => {
		const rows = [{ id: 1, name: "O'Brien" }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain("'O''Brien'")
	})

	test('handles boolean values', async () => {
		const rows = [{ id: 1, active: true }, { id: 2, active: false }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('TRUE')
		expect(content).toContain('FALSE')
	})

	test('SQLite main schema omits schema qualification', async () => {
		const driver = mockDriver(sampleRows, 'sqlite')
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql', schema: 'main' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('INSERT INTO "users"')
		expect(content).not.toContain('"main"')
	})
})

// ── Preview ────────────────────────────────────────────────

describe('exportPreview', () => {
	test('returns CSV preview', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'csv', limit: 10 })

		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('id,name,age')
		expect(lines).toHaveLength(4) // header + 3 rows
	})

	test('returns JSON preview', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'json', limit: 10 })

		const parsed = JSON.parse(content)
		expect(parsed).toHaveLength(3)
	})

	test('returns SQL preview', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'sql', limit: 10 })

		expect(content).toContain('INSERT INTO')
	})

	test('respects limit parameter', async () => {
		const driver = mockDriver(sampleRows)
		await exportPreview(driver, { ...baseParams, format: 'csv', limit: 5 })

		// Preview uses execute() not iterate()
		expect(driver.execute).toHaveBeenCalledTimes(1)
		const callArgs = (driver.execute as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('LIMIT')
	})

	test('preview uses execute() not iterate()', async () => {
		const driver = mockDriver(sampleRows)
		await exportPreview(driver, { ...baseParams, format: 'csv', limit: 10 })

		expect(driver.execute).toHaveBeenCalledTimes(1)
		expect(driver.iterate).not.toHaveBeenCalled()
	})
})

// ── Filters and Sort ───────────────────────────────────────

describe('filters and sort', () => {
	test('passes filters to iterate query', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			filters: [{ column: 'age', operator: 'gt', value: 20 }],
		}, filePath)

		const callArgs = (driver.iterate as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('WHERE')
		expect(sql).toContain('"age" > $1')
	})

	test('passes sort to iterate query', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			sort: [{ column: 'name', direction: 'asc' }],
		}, filePath)

		const callArgs = (driver.iterate as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('ORDER BY "name" ASC')
	})

	test('passes both filters and sort', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			filters: [{ column: 'age', operator: 'gte', value: 18 }],
			sort: [{ column: 'id', direction: 'desc' }],
		}, filePath)

		const callArgs = (driver.iterate as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('WHERE')
		expect(sql).toContain('ORDER BY')
	})
})

// ── Column Selection ───────────────────────────────────────

describe('column selection', () => {
	test('exports only selected columns in query', async () => {
		const rows = [{ id: 1, name: 'Alice' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			columns: ['id', 'name'],
		}, filePath)

		const callArgs = (driver.iterate as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('"id", "name"')
		expect(sql).not.toContain('*')
	})

	test('uses SELECT * when no columns specified', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.csv')

		await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		const callArgs = (driver.iterate as any).mock.calls[0]
		const sql = callArgs[0] as string
		expect(sql).toContain('SELECT *')
	})
})

// ── Row Limit ──────────────────────────────────────────────

describe('row limit', () => {
	test('respects limit option by truncating iteration', async () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `User${i + 1}` }))
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.csv')

		const result = await exportToFile(driver, {
			...baseParams,
			format: 'csv',
			limit: 3,
		}, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		// header + 3 data rows
		expect(lines).toHaveLength(4)
	})
})

// ── Empty dataset ──────────────────────────────────────────

describe('empty dataset', () => {
	test('CSV export produces only header for empty data', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.csv')

		const result = await exportToFile(driver, { ...baseParams, format: 'csv' }, filePath)

		expect(result.rowCount).toBe(0)
	})

	test('JSON export produces empty array for empty data', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.json')

		await exportToFile(driver, { ...baseParams, format: 'json' }, filePath)

		const content = await Bun.file(filePath).text()
		const parsed = JSON.parse(content)
		expect(parsed).toEqual([])
	})
})

// ── Markdown Export ────────────────────────────────────────

describe('Markdown export', () => {
	test('generates valid Markdown table with header and separator', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.md')

		const result = await exportToFile(driver, { ...baseParams, format: 'markdown' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		const lines = content.trim().split('\n')
		expect(lines[0]).toBe('| id | name | age |')
		expect(lines[1]).toBe('| --- | --- | --- |')
		expect(lines[2]).toBe('| 1 | Alice | 30 |')
		expect(lines[3]).toBe('| 2 | Bob | 25 |')
		expect(lines[4]).toBe('| 3 | Charlie | NULL |')
	})

	test('escapes pipe characters in values', async () => {
		const rows = [{ id: 1, name: 'foo|bar' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.md')

		await exportToFile(driver, { ...baseParams, format: 'markdown' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('foo\\|bar')
	})

	test('replaces newlines with spaces in values', async () => {
		const rows = [{ id: 1, name: 'Line1\nLine2' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.md')

		await exportToFile(driver, { ...baseParams, format: 'markdown' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('Line1 Line2')
	})

	test('handles empty dataset', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.md')

		const result = await exportToFile(driver, { ...baseParams, format: 'markdown' }, filePath)
		expect(result.rowCount).toBe(0)
	})

	test('preview returns Markdown', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'markdown', limit: 10 })

		expect(content).toContain('| id | name | age |')
		expect(content).toContain('| --- | --- | --- |')
		expect(content).toContain('| 1 | Alice | 30 |')
	})
})

// ── SQL UPDATE Export ──────────────────────────────────────

describe('SQL UPDATE export', () => {
	test('generates UPDATE statements with first column as PK', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.sql')

		const result = await exportToFile(driver, { ...baseParams, format: 'sql_update' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Alice\', "age" = 30 WHERE "id" = 1;')
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Bob\', "age" = 25 WHERE "id" = 2;')
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Charlie\', "age" = NULL WHERE "id" = 3;')
	})

	test('escapes single quotes in values', async () => {
		const rows = [{ id: 1, name: "O'Brien" }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql_update' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain("'O''Brien'")
	})

	test('SQLite main schema omits schema qualification', async () => {
		const driver = mockDriver(sampleRows, 'sqlite')
		const filePath = join(tmpDir, 'test.sql')

		await exportToFile(driver, { ...baseParams, format: 'sql_update', schema: 'main' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('UPDATE "users" SET')
		expect(content).not.toContain('"main"')
	})

	test('preview returns SQL UPDATE', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'sql_update', limit: 10 })

		expect(content).toContain('UPDATE')
		expect(content).toContain('SET')
		expect(content).toContain('WHERE')
	})
})

// ── HTML Export ────────────────────────────────────────────

describe('HTML export', () => {
	test('generates valid HTML table', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.html')

		const result = await exportToFile(driver, { ...baseParams, format: 'html' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		expect(content).toContain('<table>')
		expect(content).toContain('</table>')
		expect(content).toContain('<thead>')
		expect(content).toContain('<th>id</th>')
		expect(content).toContain('<th>name</th>')
		expect(content).toContain('<th>age</th>')
		expect(content).toContain('<tbody>')
		expect(content).toContain('<td>Alice</td>')
		expect(content).toContain('<td>30</td>')
		expect(content).toContain('<td></td>') // null renders as empty
	})

	test('escapes HTML special characters', async () => {
		const rows = [{ id: 1, name: '<script>alert("xss")</script>' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.html')

		await exportToFile(driver, { ...baseParams, format: 'html' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).not.toContain('<script>')
		expect(content).toContain('&lt;script&gt;')
		expect(content).toContain('&quot;xss&quot;')
	})

	test('handles empty dataset', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.html')

		await exportToFile(driver, { ...baseParams, format: 'html' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('<table>')
		expect(content).toContain('</table>')
	})

	test('preview returns HTML', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'html', limit: 10 })

		expect(content).toContain('<table>')
		expect(content).toContain('<th>id</th>')
		expect(content).toContain('<td>Alice</td>')
	})
})

// ── XML Export ─────────────────────────────────────────────

describe('XML export', () => {
	test('generates valid XML', async () => {
		const driver = mockDriver(sampleRows)
		const filePath = join(tmpDir, 'test.xml')

		const result = await exportToFile(driver, { ...baseParams, format: 'xml' }, filePath)

		expect(result.rowCount).toBe(3)
		const content = await Bun.file(filePath).text()
		expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>')
		expect(content).toContain('<rows xmlns:xsi=')
		expect(content).toContain('</rows>')
		expect(content).toContain('<row>')
		expect(content).toContain('<id>1</id>')
		expect(content).toContain('<name>Alice</name>')
		expect(content).toContain('<age>30</age>')
		expect(content).toContain('xsi:nil="true"') // null values
	})

	test('escapes XML special characters', async () => {
		const rows = [{ id: 1, name: 'Tom & Jerry <3>' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.xml')

		await exportToFile(driver, { ...baseParams, format: 'xml' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('Tom &amp; Jerry &lt;3&gt;')
	})

	test('sanitizes column names for XML tags', async () => {
		const rows = [{ '123bad': 'val', 'good_name': 'ok' }]
		const driver = mockDriver(rows)
		const filePath = join(tmpDir, 'test.xml')

		await exportToFile(driver, { ...baseParams, format: 'xml' }, filePath)

		const content = await Bun.file(filePath).text()
		// Column starting with digit should get underscore prefix
		expect(content).toContain('<_123bad>')
		expect(content).toContain('<good_name>')
	})

	test('handles empty dataset', async () => {
		const driver = mockDriver([])
		const filePath = join(tmpDir, 'test.xml')

		await exportToFile(driver, { ...baseParams, format: 'xml' }, filePath)

		const content = await Bun.file(filePath).text()
		expect(content).toContain('<rows xmlns:xsi=')
		expect(content).toContain('</rows>')
	})

	test('preview returns XML', async () => {
		const driver = mockDriver(sampleRows)
		const content = await exportPreview(driver, { ...baseParams, format: 'xml', limit: 10 })

		expect(content).toContain('<?xml version="1.0"')
		expect(content).toContain('<id>1</id>')
	})
})
