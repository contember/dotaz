import { ansiQuoteIdentifier } from '../sql/dialects'
import type { CsvDelimiter, ExportFormat } from '../types/export'

// ── Helpers ────────────────────────────────────────────────

export function collectAllColumns(rows: Record<string, unknown>[]): string[] {
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

// SQL UPDATE needs every key column in the SELECT list; append any that the
// caller's column set is missing. Shared by the backend export, the shared
// formatAll, and the export dialog so all three agree on the column set.
export function mergeKeyColumns(columns: string[], keyColumns: string[] | undefined): string[] {
	const result = [...columns]
	for (const keyColumn of keyColumns ?? []) {
		if (!result.includes(keyColumn)) {
			result.push(keyColumn)
		}
	}
	return result
}

function formatCsvValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function formatSqlValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
	if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
	return String(value)
}

function formatMarkdownValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function xmlSafeTag(name: string): string {
	// Dots are replaced because they conflict with namespace notation
	let tag = name.replace(/[^a-zA-Z0-9_-]/g, '_')
	if (!/^[a-zA-Z_]/.test(tag)) tag = '_' + tag
	return tag
}

function qualifyTableName(
	schema: string,
	table: string,
	quoteIdentifier: (name: string) => string,
): string {
	if (!schema) return quoteIdentifier(table)
	return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

// ── Formatter interface ────────────────────────────────────

export interface Formatter {
	preamble(): string
	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string
	epilogue(): string
}

export interface FormatterParams {
	format: ExportFormat
	schema: string
	table: string
	delimiter?: CsvDelimiter
	includeHeaders?: boolean
	batchSize?: number
	qualifiedTableName?: string
	quoteIdentifier?: (name: string) => string
	keyColumns?: string[]
}

export function createFormatter(params: FormatterParams): Formatter {
	const quoteIdentifier = params.quoteIdentifier ?? ansiQuoteIdentifier
	const tableName = params.qualifiedTableName ?? qualifyTableName(params.schema, params.table, quoteIdentifier)
	switch (params.format) {
		case 'csv':
			return new CsvFormatter(params.delimiter ?? ',', params.includeHeaders ?? true)
		case 'json':
			return new JsonFormatter()
		case 'sql':
			return new SqlInsertFormatter(tableName, params.batchSize ?? 100, quoteIdentifier)
		case 'markdown':
			return new MarkdownFormatter()
		case 'sql_update':
			if (!params.keyColumns || params.keyColumns.length === 0) {
				throw new Error('SQL UPDATE export requires key columns')
			}
			return new SqlUpdateFormatter(tableName, quoteIdentifier, params.keyColumns)
		case 'html':
			return new HtmlFormatter()
		case 'xml':
			return new XmlFormatter()
	}
}

// ── CSV ────────────────────────────────────────────────────

class CsvFormatter implements Formatter {
	private columns: string[] | null = null

	constructor(
		private delimiter: CsvDelimiter,
		private includeHeaders: boolean,
	) {}

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

// ── JSON ───────────────────────────────────────────────────

class JsonFormatter implements Formatter {
	private hasWritten = false

	preamble(): string {
		return '[\n'
	}

	formatBatch(rows: Record<string, unknown>[]): string {
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
	private columns: string[] | null = null

	constructor(
		private tableName: string,
		private batchSize: number,
		private quoteIdentifier: (name: string) => string,
	) {}

	preamble(): string {
		return ''
	}

	formatBatch(rows: Record<string, unknown>[]): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns
		const quotedCols = columns.map((c) => this.quoteIdentifier(c))
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

// ── SQL UPDATE ─────────────────────────────────────────────

class SqlUpdateFormatter implements Formatter {
	private columns: string[] | null = null

	constructor(
		private tableName: string,
		private quoteIdentifier: (name: string) => string,
		private keyColumns: string[],
	) {}

	preamble(): string {
		return ''
	}

	formatBatch(rows: Record<string, unknown>[]): string {
		if (rows.length === 0) return ''

		if (!this.columns) {
			this.columns = collectAllColumns(rows)
		}
		const columns = this.columns

		const keyColumnSet = new Set(this.keyColumns)
		const setCols = columns.filter((col) => !keyColumnSet.has(col))

		const statements: string[] = []

		for (const row of rows) {
			if (setCols.length === 0) continue

			for (const keyColumn of this.keyColumns) {
				if (!Object.hasOwn(row, keyColumn)) {
					throw new Error(`SQL UPDATE export key column "${keyColumn}" is missing from exported rows`)
				}
				if (row[keyColumn] === null || row[keyColumn] === undefined) {
					throw new Error(`SQL UPDATE export key column "${keyColumn}" has no value`)
				}
			}

			const setClause = setCols
				.map((col) => `${this.quoteIdentifier(col)} = ${formatSqlValue(row[col])}`)
				.join(', ')
			const whereClause = this.keyColumns
				.map((col) => `${this.quoteIdentifier(col)} = ${formatSqlValue(row[col])}`)
				.join(' AND ')

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

// ── XML ────────────────────────────────────────────────────

class XmlFormatter implements Formatter {
	private columns: string[] | null = null

	preamble(): string {
		return '<?xml version="1.0" encoding="UTF-8"?>\n<rows xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
	}

	formatBatch(rows: Record<string, unknown>[]): string {
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

// ── Convenience: format all rows at once ───────────────────

export function formatAll(
	rows: Record<string, unknown>[],
	columns: string[],
	params: FormatterParams,
): string {
	if (rows.length === 0) return ''

	const baseColumns = columns.length > 0 ? columns : collectAllColumns(rows)
	const effectiveColumns = params.format === 'sql_update'
		? mergeKeyColumns(baseColumns, params.keyColumns)
		: [...baseColumns]

	// For formats that derive columns from rows, we need to ensure the column order
	// matches what was passed. We do this by reordering row keys.
	const orderedRows = columns.length > 0
		? rows.map((row) => {
			const ordered: Record<string, unknown> = {}
			for (const col of effectiveColumns) {
				ordered[col] = row[col]
			}
			return ordered
		})
		: rows

	const formatter = createFormatter(params)
	const parts: string[] = []

	const preamble = formatter.preamble()
	if (preamble) parts.push(preamble)

	parts.push(formatter.formatBatch(orderedRows, true))

	const epilogue = formatter.epilogue()
	if (epilogue) parts.push(epilogue)

	return parts.join('')
}
