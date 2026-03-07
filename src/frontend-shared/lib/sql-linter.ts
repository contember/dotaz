import { linter, type Diagnostic } from '@codemirror/lint'
import type { SchemaData } from '../../shared/types/database'
import { connectionsStore } from '../stores/connections'
import { parseCteNames } from './alias-completion'
import { parseTableReferences } from './join-completion'

// ── Position-preserving literal/comment stripper ─────────

/**
 * Replace string literals, quoted identifiers, and comments with spaces
 * of equal length so character positions are preserved.
 */
function blankLiteralsAndComments(sql: string): string {
	const chars = sql.split('')
	let i = 0

	function blank(from: number, to: number) {
		for (let j = from; j < to; j++) {
			// keep newlines so line numbers stay correct
			if (chars[j] !== '\n') chars[j] = ' '
		}
	}

	while (i < sql.length) {
		const ch = sql[i]
		const next = i + 1 < sql.length ? sql[i + 1] : ''

		// Line comment
		if (ch === '-' && next === '-') {
			const start = i
			const lineEnd = sql.indexOf('\n', i)
			i = lineEnd === -1 ? sql.length : lineEnd
			blank(start, i)
			continue
		}

		// Block comment
		if (ch === '/' && next === '*') {
			const start = i
			const endIdx = sql.indexOf('*/', i + 2)
			i = endIdx === -1 ? sql.length : endIdx + 2
			blank(start, i)
			continue
		}

		// Dollar-quoted string
		if (ch === '$') {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/)
			if (tagMatch) {
				const tag = tagMatch[1]
				const start = i
				const endIdx = sql.indexOf(tag, i + tag.length)
				i = endIdx === -1 ? sql.length : endIdx + tag.length
				blank(start, i)
				continue
			}
		}

		// Single-quoted string
		if (ch === "'") {
			const start = i
			i++
			while (i < sql.length) {
				if (sql[i] === "'") {
					i++
					if (i < sql.length && sql[i] === "'") {
						i++
					} else {
						break
					}
				} else {
					i++
				}
			}
			blank(start, i)
			continue
		}

		// Double-quoted identifier
		if (ch === '"') {
			const start = i
			i++
			while (i < sql.length) {
				if (sql[i] === '"') {
					i++
					if (i < sql.length && sql[i] === '"') {
						i++
					} else {
						break
					}
				} else {
					i++
				}
			}
			blank(start, i)
			continue
		}

		i++
	}

	return chars.join('')
}

// ── Table reference finder with positions ────────────────

interface TableRefWithPos {
	schema?: string
	table: string
	/** Offset in the doc where the table name starts */
	from: number
	/** Offset in the doc where the table name ends */
	to: number
}

/**
 * Find FROM/JOIN table references with their positions in the blanked SQL.
 */
function findTableRefsWithPositions(blanked: string): TableRefWithPos[] {
	const refs: TableRefWithPos[] = []
	const pattern = /\b(?:FROM|JOIN)\s+((\w+)(?:\.(\w+))?)/gi
	let match: RegExpExecArray | null
	while ((match = pattern.exec(blanked)) !== null) {
		const part1 = match[2]
		const part2 = match[3]
		if (part2) {
			// schema.table — only flag the table part
			const tableStart = match.index + match[0].length - part2.length
			refs.push({ schema: part1, table: part2, from: tableStart, to: tableStart + part2.length })
		} else {
			const tableStart = match.index + match[0].length - part1.length
			refs.push({ table: part1, from: tableStart, to: tableStart + part1.length })
		}
	}
	return refs
}

// ── Column reference finder with positions ───────────────

interface ColumnRefWithPos {
	qualifier: string
	column: string
	from: number
	to: number
}

/**
 * Find alias.column references with positions.
 */
function findColumnRefsWithPositions(blanked: string): ColumnRefWithPos[] {
	const refs: ColumnRefWithPos[] = []
	// Match word.word but not schema.table in FROM/JOIN (those are handled above)
	const pattern = /\b(\w+)\.(\w+)\b/g
	let match: RegExpExecArray | null
	while ((match = pattern.exec(blanked)) !== null) {
		const qualifier = match[1]
		const column = match[2]
		const colStart = match.index + qualifier.length + 1 // after the dot
		refs.push({ qualifier, column, from: colStart, to: colStart + column.length })
	}
	return refs
}

// ── Table existence check ────────────────────────────────

function tableExistsInSchema(
	schemaData: SchemaData,
	tableName: string,
	schemaName: string | undefined,
	defaultSchema: string,
	isSqlite: boolean,
): boolean {
	if (isSqlite) {
		// SQLite: tables keyed by schema name (usually 'main')
		for (const schema of schemaData.schemas) {
			const tables = schemaData.tables[schema.name] ?? []
			if (tables.some((t) => t.name.toLowerCase() === tableName.toLowerCase())) {
				return true
			}
		}
		return false
	}

	const schema = schemaName ?? defaultSchema
	const tables = schemaData.tables[schema] ?? []
	return tables.some((t) => t.name.toLowerCase() === tableName.toLowerCase())
}

// ── SQL keywords that look like table names ──────────────

const SQL_KEYWORDS_LOWER = new Set([
	'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full',
	'cross', 'natural', 'outer', 'on', 'and', 'or', 'not', 'in', 'is',
	'null', 'as', 'between', 'like', 'exists', 'case', 'when', 'then',
	'else', 'end', 'group', 'order', 'having', 'limit', 'offset', 'union',
	'except', 'intersect', 'set', 'into', 'values', 'insert', 'update',
	'delete', 'create', 'drop', 'alter', 'table', 'index', 'view',
	'true', 'false', 'distinct', 'all', 'any', 'some', 'asc', 'desc',
	'by', 'with', 'recursive', 'lateral', 'using', 'returning', 'cascade',
	'restrict', 'default', 'check', 'primary', 'key', 'foreign',
	'references', 'unique', 'constraint', 'if', 'begin', 'commit',
	'rollback', 'grant', 'revoke', 'explain', 'analyze', 'vacuum',
	'fetch', 'first', 'next', 'row', 'rows', 'only', 'top', 'count',
	'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'cast',
	'extract', 'substring', 'trim', 'upper', 'lower', 'length',
	'replace', 'concat', 'now', 'current_timestamp', 'current_date',
	'current_time', 'interval', 'generate_series', 'unnest', 'array_agg',
	'string_agg', 'json_agg', 'jsonb_agg', 'row_number', 'rank',
	'dense_rank', 'over', 'partition', 'window', 'filter', 'within',
	'ilike', 'similar', 'to', 'escape', 'collate', 'tablesample',
	'bernoulli', 'system', 'do', 'nothing', 'conflict',
])

// ── Main linter ──────────────────────────────────────────

/**
 * Create a CodeMirror linter extension for live SQL error highlighting.
 * Validates table and column names against the loaded schema.
 */
export function createSqlLinter(
	connectionId: string,
	database: string | undefined,
	isSqlite: boolean,
) {
	const defaultSchema = isSqlite ? 'main' : 'public'

	return linter((view) => {
		const diagnostics: Diagnostic[] = []
		const doc = view.state.doc.toString()
		if (doc.trim().length === 0) return diagnostics

		const schemaData = connectionsStore.getSchemaData(connectionId, database)
		if (!schemaData) return diagnostics

		const blanked = blankLiteralsAndComments(doc)
		const cteNames = parseCteNames(doc)
		const cteNamesLower = new Set(cteNames.map((n) => n.toLowerCase()))
		const tableRefs = parseTableReferences(doc)

		// Build a map of alias/table -> schema.table for column validation
		const aliasToKey = new Map<string, string>()
		for (const ref of tableRefs) {
			const schema = ref.schema ?? defaultSchema
			const key = `${schema}.${ref.table}`
			if (ref.alias) {
				aliasToKey.set(ref.alias.toLowerCase(), key)
			}
			aliasToKey.set(ref.table.toLowerCase(), key)
		}

		// Also map CTE names so they don't produce column errors
		for (const cte of cteNames) {
			aliasToKey.set(cte.toLowerCase(), `__cte__:${cte}`)
		}

		// Check table references
		const tableRefsWithPos = findTableRefsWithPositions(blanked)
		for (const ref of tableRefsWithPos) {
			const name = ref.table.toLowerCase()

			// Skip SQL keywords
			if (SQL_KEYWORDS_LOWER.has(name)) continue

			// Skip CTEs
			if (cteNamesLower.has(name)) continue

			if (!tableExistsInSchema(schemaData, ref.table, ref.schema, defaultSchema, isSqlite)) {
				diagnostics.push({
					from: ref.from,
					to: ref.to,
					severity: 'error',
					message: `Table "${ref.table}" not found${ref.schema ? ` in schema "${ref.schema}"` : ''}`,
					source: 'sql',
				})
			}
		}

		// Check column references (alias.column)
		const colRefs = findColumnRefsWithPositions(blanked)
		for (const ref of colRefs) {
			const qualLower = ref.qualifier.toLowerCase()

			// Skip if qualifier is a SQL keyword (e.g. CURRENT_DATE.something — unlikely but safe)
			if (SQL_KEYWORDS_LOWER.has(qualLower)) continue

			const tableKey = aliasToKey.get(qualLower)
			if (!tableKey) continue // Unknown qualifier — don't flag (could be schema ref, function, etc.)

			// Skip CTE references — we don't know their columns
			if (tableKey.startsWith('__cte__:')) continue

			const columns = schemaData.columns[tableKey]
			if (!columns) continue // No column info loaded — don't flag

			const colExists = columns.some((c) => c.name.toLowerCase() === ref.column.toLowerCase())
			if (!colExists) {
				// Extract the display table name from the key
				const tableName = tableKey.split('.').pop() ?? tableKey
				diagnostics.push({
					from: ref.from,
					to: ref.to,
					severity: 'error',
					message: `Column "${ref.column}" not found in table "${tableName}"`,
					source: 'sql',
				})
			}
		}

		return diagnostics
	}, { delay: 400 })
}
