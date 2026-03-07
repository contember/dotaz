import type { CsvDelimiter, ExportFormat } from '../../shared/types/export'

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

function qualifyTable(schema: string, table: string): string {
	return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`
}

// ── CSV ────────────────────────────────────────────────────

function formatCsvValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function escapeCsvField(value: string, delimiter: CsvDelimiter): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return `"${value.replace(/"/g, '""')}"`
	}
	return value
}

function formatCsv(rows: Record<string, unknown>[], columns: string[], delimiter: CsvDelimiter, includeHeaders: boolean): string {
	const lines: string[] = []
	if (includeHeaders) {
		lines.push(columns.map((c) => escapeCsvField(c, delimiter)).join(delimiter))
	}
	for (const row of rows) {
		lines.push(columns.map((col) => escapeCsvField(formatCsvValue(row[col]), delimiter)).join(delimiter))
	}
	return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

// ── JSON ───────────────────────────────────────────────────

function formatJson(rows: Record<string, unknown>[]): string {
	return '[\n' + rows.map((row, i) => (i > 0 ? ',\n' : '') + '  ' + JSON.stringify(row)).join('') + '\n]\n'
}

// ── SQL INSERT ─────────────────────────────────────────────

function formatSqlValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
	if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
	return String(value)
}

function formatSqlInsert(rows: Record<string, unknown>[], columns: string[], tableName: string, batchSize: number): string {
	const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`)
	const colList = quotedCols.join(', ')
	const statements: string[] = []
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize)
		const valueGroups = batch.map((row) => {
			const vals = columns.map((col) => formatSqlValue(row[col]))
			return `(${vals.join(', ')})`
		})
		statements.push(`INSERT INTO ${tableName} (${colList}) VALUES\n${valueGroups.join(',\n')};\n`)
	}
	return statements.join('\n')
}

// ── Markdown ───────────────────────────────────────────────

function formatMarkdownValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function formatMarkdown(rows: Record<string, unknown>[], columns: string[]): string {
	const lines: string[] = []
	lines.push('| ' + columns.map(escapeMarkdownCell).join(' | ') + ' |')
	lines.push('| ' + columns.map(() => '---').join(' | ') + ' |')
	for (const row of rows) {
		lines.push('| ' + columns.map((col) => escapeMarkdownCell(formatMarkdownValue(row[col]))).join(' | ') + ' |')
	}
	return lines.join('\n') + '\n'
}

// ── SQL UPDATE ─────────────────────────────────────────────

function formatSqlUpdate(rows: Record<string, unknown>[], columns: string[], tableName: string): string {
	if (columns.length === 0) return ''
	const pkColumn = columns[0]
	const setCols = columns.slice(1)
	const statements: string[] = []
	for (const row of rows) {
		if (setCols.length === 0) continue
		const setClause = setCols
			.map((col) => `"${col.replace(/"/g, '""')}" = ${formatSqlValue(row[col])}`)
			.join(', ')
		const whereClause = `"${pkColumn.replace(/"/g, '""')}" = ${formatSqlValue(row[pkColumn])}`
		statements.push(`UPDATE ${tableName} SET ${setClause} WHERE ${whereClause};\n`)
	}
	return statements.join('')
}

// ── HTML ───────────────────────────────────────────────────

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function formatHtml(rows: Record<string, unknown>[], columns: string[]): string {
	const lines: string[] = ['<table>', '  <thead>', '    <tr>']
	for (const col of columns) lines.push(`      <th>${escapeHtml(col)}</th>`)
	lines.push('    </tr>', '  </thead>', '  <tbody>')
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
	lines.push('  </tbody>', '</table>')
	return lines.join('\n') + '\n'
}

// ── XML ────────────────────────────────────────────────────

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function xmlSafeTag(name: string): string {
	let tag = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
	if (!/^[a-zA-Z_]/.test(tag)) tag = '_' + tag
	return tag
}

function formatXml(rows: Record<string, unknown>[], columns: string[]): string {
	const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<rows>']
	for (const row of rows) {
		lines.push('  <row>')
		for (const col of columns) {
			const value = row[col]
			const tag = xmlSafeTag(col)
			if (value === null || value === undefined) {
				lines.push(`    <${tag} xsi:nil="true"/>`)
			} else {
				const display = typeof value === 'object' ? escapeXml(JSON.stringify(value)) : escapeXml(String(value))
				lines.push(`    <${tag}>${display}</${tag}>`)
			}
		}
		lines.push('  </row>')
	}
	lines.push('</rows>')
	return lines.join('\n') + '\n'
}

// ── Main export ────────────────────────────────────────────

export function formatPreview(
	rows: Record<string, unknown>[] | null,
	columns: string[],
	format: ExportFormat,
	delimiter: CsvDelimiter,
	includeHeaders: boolean,
	batchSize: number,
	schema: string,
	table: string,
): string {
	if (!rows || rows.length === 0) return ''
	const effectiveColumns = columns.length > 0 ? columns : collectAllColumns(rows)
	const tableName = qualifyTable(schema, table)
	switch (format) {
		case 'csv':
			return formatCsv(rows, effectiveColumns, delimiter, includeHeaders)
		case 'json':
			return formatJson(rows)
		case 'sql':
			return formatSqlInsert(rows, effectiveColumns, tableName, batchSize)
		case 'markdown':
			return formatMarkdown(rows, effectiveColumns)
		case 'sql_update':
			return formatSqlUpdate(rows, effectiveColumns, tableName)
		case 'html':
			return formatHtml(rows, effectiveColumns)
		case 'xml':
			return formatXml(rows, effectiveColumns)
	}
}
