import { buildOrderByClause, buildWhereClause } from '../../shared/sql/builders'
import type { CsvDelimiter, CsvEncoding, ExportFormat } from '../../shared/types/export'
import type { ColumnFilter, SortColumn } from '../../shared/types/grid'
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
	const formatter = createFormatter(params, driver)
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

	const formatter = createFormatter(params, driver)
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
	const from = driver.qualifyTable(params.schema, params.table)
	const columnList = params.columns && params.columns.length > 0
		? params.columns.map((c) => driver.quoteIdentifier(c)).join(', ')
		: '*'
	const where = buildWhereClause(params.filters, driver)
	const orderBy = buildOrderByClause(params.sort, driver)

	const parts = [`SELECT ${columnList} FROM ${from}`]
	if (where.sql) parts.push(where.sql)
	if (orderBy) parts.push(orderBy)

	return {
		sql: parts.join(' '),
		params: [...where.params],
	}
}

// ── Helpers ────────────────────────────────────────────────

/** Collect all unique column names across all rows, preserving insertion order. */
function collectAllColumns(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>()
	const columns: string[] = []
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key)
				columns.push(key)
			}
		}
	}
	return columns
}

// ── Formatters ─────────────────────────────────────────────

interface Formatter {
	preamble(): string
	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string
	epilogue(): string
}

function createFormatter(params: ExportParams, driver: DatabaseDriver): Formatter {
	switch (params.format) {
		case 'csv':
			return new CsvFormatter(params.delimiter ?? ',', params.includeHeaders ?? true)
		case 'json':
			return new JsonFormatter()
		case 'sql':
			return new SqlInsertFormatter(
				params.schema,
				params.table,
				driver,
				params.batchSize ?? 100,
			)
		case 'markdown':
			return new MarkdownFormatter()
		case 'sql_update':
			return new SqlUpdateFormatter(params.schema, params.table, driver)
		case 'html':
			return new HtmlFormatter()
		case 'xml':
			return new XmlFormatter()
	}
}

// ── CSV ────────────────────────────────────────────────────

class CsvFormatter implements Formatter {
	constructor(
		private delimiter: CsvDelimiter,
		private includeHeaders: boolean,
	) {}

	preamble(): string {
		return ''
	}

	private columns: string[] | null = null

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return ''

		// Derive columns from the first batch; subsequent batches reuse the same set
		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns

		const lines: string[] = []

		if (isFirst && this.includeHeaders) {
			lines.push(columns.map((c) => this.escapeField(c)).join(this.delimiter))
		}

		for (const row of rows) {
			const fields = columns.map((col) => this.escapeField(formatCsvValue(row[col])))
			lines.push(fields.join(this.delimiter))
		}

		return lines.join('\n') + '\n'
	}

	epilogue(): string {
		return ''
	}

	private escapeField(value: string): string {
		if (value.includes(this.delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
			return `"${value.replace(/"/g, '""')}"`
		}
		return value
	}
}

function formatCsvValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

// ── JSON ───────────────────────────────────────────────────

class JsonFormatter implements Formatter {
	private hasWritten = false

	preamble(): string {
		return '[\n'
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return ''

		const lines = rows.map((row) => {
			const prefix = this.hasWritten ? ',\n' : ''
			this.hasWritten = true
			return prefix + '  ' + JSON.stringify(row)
		})

		return lines.join('')
	}

	epilogue(): string {
		return '\n]\n'
	}
}

// ── SQL INSERT ─────────────────────────────────────────────

class SqlInsertFormatter implements Formatter {
	private tableName: string

	constructor(
		schema: string,
		table: string,
		driver: DatabaseDriver,
		private batchSize: number,
	) {
		this.tableName = driver.qualifyTable(schema, table)
	}

	preamble(): string {
		return ''
	}

	private columns: string[] | null = null

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return ''

		// Derive columns from the first batch; subsequent batches reuse the same set
		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns
		const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`)
		const colList = quotedCols.join(', ')

		const statements: string[] = []

		for (let i = 0; i < rows.length; i += this.batchSize) {
			const batch = rows.slice(i, i + this.batchSize)
			const valueGroups = batch.map((row) => {
				const vals = columns.map((col) => formatSqlValue(row[col]))
				return `(${vals.join(', ')})`
			})

			statements.push(
				`INSERT INTO ${this.tableName} (${colList}) VALUES\n${valueGroups.join(',\n')};\n`,
			)
		}

		return statements.join('\n')
	}

	epilogue(): string {
		return ''
	}
}

function formatSqlValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
	if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
	return String(value)
}

// ── Markdown ───────────────────────────────────────────────

class MarkdownFormatter implements Formatter {
	private columns: string[] | null = null

	preamble(): string {
		return ''
	}

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns
		const lines: string[] = []

		if (isFirst) {
			lines.push('| ' + columns.map(escapeMarkdownCell).join(' | ') + ' |')
			lines.push('| ' + columns.map(() => '---').join(' | ') + ' |')
		}

		for (const row of rows) {
			const cells = columns.map((col) => escapeMarkdownCell(formatMarkdownValue(row[col])))
			lines.push('| ' + cells.join(' | ') + ' |')
		}

		return lines.join('\n') + '\n'
	}

	epilogue(): string {
		return ''
	}
}

function formatMarkdownValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

// ── SQL UPDATE ─────────────────────────────────────────────

class SqlUpdateFormatter implements Formatter {
	private tableName: string
	private columns: string[] | null = null

	constructor(
		schema: string,
		table: string,
		driver: DatabaseDriver,
	) {
		this.tableName = driver.qualifyTable(schema, table)
	}

	preamble(): string {
		return ''
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns

		// Use first column as PK for WHERE clause (convention: first column is typically the PK)
		const pkColumn = columns[0]
		const setCols = columns.slice(1)

		const statements: string[] = []

		for (const row of rows) {
			if (setCols.length === 0) continue

			const setClause = setCols
				.map((col) => `"${col.replace(/"/g, '""')}" = ${formatSqlValue(row[col])}`)
				.join(', ')
			const whereClause = `"${pkColumn.replace(/"/g, '""')}" = ${formatSqlValue(row[pkColumn])}`

			statements.push(
				`UPDATE ${this.tableName} SET ${setClause} WHERE ${whereClause};\n`,
			)
		}

		return statements.join('')
	}

	epilogue(): string {
		return ''
	}
}

// ── HTML ───────────────────────────────────────────────────

class HtmlFormatter implements Formatter {
	private columns: string[] | null = null

	preamble(): string {
		return '<table>\n'
	}

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns
		const lines: string[] = []

		if (isFirst) {
			lines.push('  <thead>')
			lines.push('    <tr>')
			for (const col of columns) {
				lines.push(`      <th>${escapeHtml(col)}</th>`)
			}
			lines.push('    </tr>')
			lines.push('  </thead>')
			lines.push('  <tbody>')
		}

		for (const row of rows) {
			lines.push('    <tr>')
			for (const col of columns) {
				const value = row[col]
				const display = value === null || value === undefined
					? ''
					: typeof value === 'object'
					? escapeHtml(JSON.stringify(value))
					: escapeHtml(String(value))
				lines.push(`      <td>${display}</td>`)
			}
			lines.push('    </tr>')
		}

		return lines.join('\n') + '\n'
	}

	epilogue(): string {
		return '  </tbody>\n</table>\n'
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

// ── XML ────────────────────────────────────────────────────

class XmlFormatter implements Formatter {
	private columns: string[] | null = null

	preamble(): string {
		return '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n'
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns
		const lines: string[] = []

		for (const row of rows) {
			lines.push('  <row>')
			for (const col of columns) {
				const value = row[col]
				const tag = xmlSafeTag(col)
				if (value === null || value === undefined) {
					lines.push(`    <${tag} xsi:nil="true"/>`)
				} else {
					const display = typeof value === 'object'
						? escapeXml(JSON.stringify(value))
						: escapeXml(String(value))
					lines.push(`    <${tag}>${display}</${tag}>`)
				}
			}
			lines.push('  </row>')
		}

		return lines.join('\n') + '\n'
	}

	epilogue(): string {
		return '</rows>\n'
	}
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

/** Convert a column name to a valid XML tag name. */
function xmlSafeTag(name: string): string {
	// XML tags must start with a letter or underscore, contain only letters/digits/hyphens/dots/underscores
	let tag = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
	if (!/^[a-zA-Z_]/.test(tag)) tag = '_' + tag
	return tag
}

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
