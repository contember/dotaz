import { collectAllColumns, createFormatter } from '@dotaz/shared/export/formatters'
import type { Formatter } from '@dotaz/shared/export/formatters'
import { buildJoinClause, buildOrderByClause, buildWhereClause, createColumnResolver } from '@dotaz/shared/sql/builders'
import type { CsvDelimiter, CsvEncoding, ExportFormat } from '@dotaz/shared/types/export'
import type { AutoJoinDef } from '@dotaz/shared/types/grid'
import type { ColumnFilter, SortColumn } from '@dotaz/shared/types/grid'
import type { DatabaseDriver } from '../db/driver'

const BATCH_SIZE = 1000

export interface ExportParams {
	schema: string
	table: string
	format: ExportFormat
	columns?: string[]
	includeHeaders?: boolean
	delimiter?: CsvDelimiter
	encoding?: CsvEncoding
	utf8Bom?: boolean
	batchSize?: number
	filters?: ColumnFilter[]
	sort?: SortColumn[]
	limit?: number
	autoJoins?: AutoJoinDef[]
}

export interface ExportStreamResult {
	rowCount: number
}

export interface ExportFileResult {
	rowCount: number
	sizeBytes: number
}

export interface ExportWriter {
	write(chunk: string | Uint8Array): void | Promise<void>
	end(): Promise<void>
}

/**
 * Stream data from a table through a writer in the specified export format.
 * Uses driver.iterate() for efficient batched reading — no LIMIT/OFFSET in service.
 */
export async function exportToStream(
	driver: DatabaseDriver,
	params: ExportParams,
	writer: ExportWriter,
	signal?: AbortSignal,
	onProgress?: (rowCount: number) => void,
): Promise<ExportStreamResult> {
	const encode = createEncoder(params.format === 'csv' ? params.encoding : undefined)
	const formatter = createExportFormatter(params, driver)
	let totalRows = 0

	// Write UTF-8 BOM if requested
	if (params.format === 'csv' && params.utf8Bom && (params.encoding ?? 'utf-8') === 'utf-8') {
		await writer.write(new Uint8Array([0xEF, 0xBB, 0xBF]))
	}

	// Write header/preamble
	const preamble = formatter.preamble()
	if (preamble) await writer.write(encode(preamble))

	const { sql, params: queryParams } = buildExportSelectQuery(params, driver)
	const batchSize = params.batchSize ?? BATCH_SIZE
	const iterator = driver.iterate(sql, queryParams, batchSize, signal)
	let isFirst = true

	for await (const batch of iterator) {
		let rows = batch

		// If a limit is set, truncate the batch if we'd exceed it
		if (params.limit !== undefined) {
			const remaining = params.limit - totalRows
			if (remaining <= 0) break
			if (rows.length > remaining) {
				rows = rows.slice(0, remaining)
			}
		}

		const chunk = formatter.formatBatch(rows, isFirst)
		await writer.write(encode(chunk))

		totalRows += rows.length
		onProgress?.(totalRows)
		isFirst = false

		if (params.limit !== undefined && totalRows >= params.limit) break
	}

	// Write footer/epilogue
	const epilogue = formatter.epilogue()
	if (epilogue) await writer.write(encode(epilogue))

	await writer.end()

	return { rowCount: totalRows }
}

/**
 * Convenience wrapper: export data to a file on disk.
 * Wraps exportToStream() with Bun.file().writer().
 */
export async function exportToFile(
	driver: DatabaseDriver,
	params: ExportParams,
	filePath: string,
	signal?: AbortSignal,
	onProgress?: (rowCount: number) => void,
): Promise<ExportFileResult> {
	const file = Bun.file(filePath)
	const bunWriter = file.writer()
	const writer: ExportWriter = {
		write(chunk) {
			bunWriter.write(chunk)
		},
		async end() {
			await bunWriter.end()
		},
	}

	try {
		const result = await exportToStream(driver, params, writer, signal, onProgress)
		const stat = await Bun.file(filePath).stat()
		return { rowCount: result.rowCount, sizeBytes: stat?.size ?? 0 }
	} catch (err) {
		await bunWriter.end()
		try {
			const { unlink } = await import('node:fs/promises')
			await unlink(filePath)
		} catch {
			// Best-effort cleanup
		}
		throw err
	}
}

/**
 * Generate a preview string of the first N rows in the given format.
 * Uses a single LIMIT query (not iterate) — suitable for small previews.
 */
export async function exportPreview(
	driver: DatabaseDriver,
	params: ExportParams,
): Promise<string> {
	const limit = params.limit ?? 10
	const { sql: baseSql, params: queryParams } = buildExportSelectQuery(params, driver)

	// Add LIMIT for preview
	let paramIndex = queryParams.length
	paramIndex++
	const limitParam = driver.placeholder(paramIndex)
	const sql = `${baseSql} LIMIT ${limitParam}`

	const result = await driver.execute(sql, [...queryParams, limit])
	const rows = result.rows

	const formatter = createExportFormatter(params, driver)
	const parts: string[] = []

	const preamble = formatter.preamble()
	if (preamble) parts.push(preamble)

	parts.push(formatter.formatBatch(rows, true))

	const epilogue = formatter.epilogue()
	if (epilogue) parts.push(epilogue)

	return parts.join('')
}

// ── Query building ─────────────────────────────────────────

/**
 * Build a SELECT query without LIMIT/OFFSET — columns, FROM, WHERE, ORDER BY only.
 */
export function buildExportSelectQuery(
	params: ExportParams,
	driver: DatabaseDriver,
): { sql: string; params: unknown[] } {
	const autoJoins = params.autoJoins
	const hasJoins = autoJoins && autoJoins.length > 0

	const from = driver.qualifyTable(params.schema, params.table)
	const resolver = hasJoins ? createColumnResolver(autoJoins, driver) : undefined
	const where = buildWhereClause(params.filters, driver, 0, resolver)
	const orderBy = buildOrderByClause(params.sort, driver, resolver)

	if (hasJoins) {
		// Build join clause
		const joinSql = buildJoinClause(autoJoins, driver)

		// Build select list — for joins we need explicit column aliases
		let selectList = 't0.*'
		if (params.columns && params.columns.length > 0) {
			selectList = params.columns.map((c) => {
				if (c.includes('.')) {
					return `${resolver!(c)} AS ${driver.quoteIdentifier(c)}`
				}
				return `t0.${driver.quoteIdentifier(c)}`
			}).join(', ')
		}

		const parts = [`SELECT ${selectList} FROM ${from} AS t0 ${joinSql}`]
		if (where.sql) parts.push(where.sql)
		if (orderBy) parts.push(orderBy)
		return { sql: parts.join(' '), params: [...where.params] }
	}

	const columnList = params.columns && params.columns.length > 0
		? params.columns.map((c) => driver.quoteIdentifier(c)).join(', ')
		: '*'

	const parts = [`SELECT ${columnList} FROM ${from}`]
	if (where.sql) parts.push(where.sql)
	if (orderBy) parts.push(orderBy)

	return {
		sql: parts.join(' '),
		params: [...where.params],
	}
}

// ── Helpers ────────────────────────────────────────────────

function createExportFormatter(params: ExportParams, driver: DatabaseDriver): Formatter {
	return createFormatter({
		format: params.format,
		schema: params.schema,
		table: params.table,
		delimiter: params.delimiter,
		includeHeaders: params.includeHeaders,
		batchSize: params.batchSize,
		qualifiedTableName: driver.qualifyTable(params.schema, params.table),
	})
}

export { collectAllColumns }

// ── Encoding ───────────────────────────────────────────────

/** Unicode codepoint → Windows-1252 byte for the 0x80–0x9F range */
const UNICODE_TO_WIN1252: Record<number, number> = {
	8364: 0x80,
	8218: 0x82,
	402: 0x83,
	8222: 0x84,
	8230: 0x85,
	8224: 0x86,
	8225: 0x87,
	710: 0x88,
	8240: 0x89,
	352: 0x8A,
	8249: 0x8B,
	338: 0x8C,
	381: 0x8E,
	8216: 0x91,
	8217: 0x92,
	8220: 0x93,
	8221: 0x94,
	8226: 0x95,
	8211: 0x96,
	8212: 0x97,
	732: 0x98,
	8482: 0x99,
	353: 0x9A,
	8250: 0x9B,
	339: 0x9C,
	382: 0x9E,
	376: 0x9F,
}

function encodeToLatin1(str: string): Uint8Array {
	const buf = new Uint8Array(str.length)
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i)
		buf[i] = code <= 0xFF ? code : 0x3F // '?' for unmappable
	}
	return buf
}

function encodeToWindows1252(str: string): Uint8Array {
	const buf = new Uint8Array(str.length)
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i)
		if (code <= 0xFF) {
			buf[i] = code
		} else {
			buf[i] = UNICODE_TO_WIN1252[code] ?? 0x3F // '?' for unmappable
		}
	}
	return buf
}

type ChunkEncoder = (str: string) => string | Uint8Array

function createEncoder(encoding?: CsvEncoding): ChunkEncoder {
	switch (encoding) {
		case 'iso-8859-1':
			return encodeToLatin1
		case 'windows-1252':
			return encodeToWindows1252
		default:
			return (str) => str // UTF-8 — BunFileWriter handles string→UTF-8
	}
}
