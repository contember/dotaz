import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { ForeignKeyInfo, ReferencingForeignKeyInfo, SchemaData } from '../../shared/types/database'
import { connectionsStore } from '../stores/connections'

// ── Types ─────────────────────────────────────────────────

interface TableRef {
	schema?: string
	table: string
	alias?: string
}

// ── SQL keyword filter ────────────────────────────────────

const SQL_KEYWORDS = new Set([
	'ON',
	'INNER',
	'LEFT',
	'RIGHT',
	'FULL',
	'CROSS',
	'NATURAL',
	'OUTER',
	'WHERE',
	'GROUP',
	'ORDER',
	'HAVING',
	'LIMIT',
	'OFFSET',
	'UNION',
	'EXCEPT',
	'INTERSECT',
	'SET',
	'INTO',
	'VALUES',
	'SELECT',
	'FROM',
	'JOIN',
	'AND',
	'OR',
	'NOT',
	'IN',
	'IS',
	'NULL',
	'AS',
	'BETWEEN',
	'LIKE',
	'EXISTS',
	'CASE',
	'WHEN',
	'THEN',
	'ELSE',
	'END',
])

// ── Parsing helpers ───────────────────────────────────────

/**
 * Parse table references (FROM and JOIN) from SQL text.
 * Returns all table names with optional schema and alias.
 */
export function parseTableReferences(text: string): TableRef[] {
	const refs: TableRef[] = []
	// Match FROM/JOIN + [schema.]table — don't try to capture alias in the same regex
	// to avoid greedily consuming SQL keywords and advancing past the next JOIN
	const pattern = /\b(?:FROM|JOIN)\s+((\w+)(?:\.(\w+))?)/gi
	let match: RegExpExecArray | null
	while ((match = pattern.exec(text)) !== null) {
		const part1 = match[2] // first word (could be schema or table)
		const part2 = match[3] // second word after dot (table when schema-qualified)

		// Look ahead for an alias after the table name
		const afterTable = text.slice(match.index + match[0].length)
		const aliasMatch = afterTable.match(/^\s+(?:AS\s+)?(\w+)/i)
		let alias: string | undefined
		if (aliasMatch) {
			const candidate = aliasMatch[1]
			if (!SQL_KEYWORDS.has(candidate.toUpperCase())) {
				alias = candidate
			}
		}

		const ref: TableRef = part2
			? { schema: part1, table: part2 }
			: { table: part1 }
		if (alias) ref.alias = alias
		refs.push(ref)
	}
	return refs
}

/**
 * Detect if cursor is positioned after a JOIN keyword.
 * Returns the document offset where the partial table name starts, or null.
 */
export function detectJoinContext(
	textBefore: string,
): { from: number; partial: string } | null {
	const match = textBefore.match(
		/\b(?:(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL)\s+(?:OUTER\s+)?)?JOIN\s+(\w*)$/i,
	)
	if (!match) return null

	const partial = match[1] ?? ''
	const from = textBefore.length - partial.length
	return { from, partial }
}

// ── Completion building ───────────────────────────────────

function buildOnClause(
	sourceLabel: string,
	targetLabel: string,
	sourceColumns: string[],
	targetColumns: string[],
): string {
	const conditions = sourceColumns.map(
		(col, i) => `${sourceLabel}.${col} = ${targetLabel}.${targetColumns[i]}`,
	)
	return conditions.join(' AND ')
}

/**
 * Build JOIN completions from FK relationships for the given table references.
 */
export function buildJoinCompletions(
	tableRefs: TableRef[],
	schemaData: SchemaData,
	isSqlite: boolean,
	defaultSchema: string,
): Completion[] {
	const completions: Completion[] = []
	const seen = new Set<string>()

	for (const ref of tableRefs) {
		const schema = ref.schema ?? defaultSchema
		const key = `${schema}.${ref.table}`
		const sourceLabel = ref.alias
			?? (isSqlite
				? ref.table
				: ref.schema
				? `${ref.schema}.${ref.table}`
				: ref.table)

		// Outgoing FKs: this table has a column pointing to another table
		const fks: ForeignKeyInfo[] = schemaData.foreignKeys[key] ?? []
		for (const fk of fks) {
			const targetLabel = isSqlite
				? fk.referencedTable
				: `${fk.referencedSchema}.${fk.referencedTable}`
			const onClause = buildOnClause(
				sourceLabel,
				targetLabel,
				fk.columns,
				fk.referencedColumns,
			)
			const applyText = `${targetLabel} ON ${onClause}`

			if (seen.has(applyText)) continue
			seen.add(applyText)

			completions.push({
				label: fk.referencedTable,
				detail: `FK: ${fk.columns.join(', ')} → ${fk.referencedTable}`,
				apply: applyText,
				boost: 10,
				type: 'keyword',
			})
		}

		// Incoming FKs: another table has a column pointing to this table
		const refFks: ReferencingForeignKeyInfo[] = schemaData.referencingForeignKeys[key] ?? []
		for (const refFk of refFks) {
			const targetLabel = isSqlite
				? refFk.referencingTable
				: `${refFk.referencingSchema}.${refFk.referencingTable}`
			const onClause = buildOnClause(
				sourceLabel,
				targetLabel,
				refFk.referencedColumns,
				refFk.referencingColumns,
			)
			const applyText = `${targetLabel} ON ${onClause}`

			if (seen.has(applyText)) continue
			seen.add(applyText)

			completions.push({
				label: refFk.referencingTable,
				detail: `FK: ${refFk.referencingTable}.${refFk.referencingColumns.join(', ')}`,
				apply: applyText,
				boost: 10,
				type: 'keyword',
			})
		}
	}

	return completions
}

// ── Completion source ─────────────────────────────────────

/**
 * Create a CodeMirror completion source that suggests FK-aware JOIN completions.
 *
 * After a JOIN keyword, FK-related tables appear first with auto-completed ON clauses.
 * Works for all JOIN types (INNER, LEFT, RIGHT, FULL, CROSS, NATURAL).
 */
export function createJoinCompletionSource(
	connectionId: string,
	database: string | undefined,
	isSqlite: boolean,
): (context: CompletionContext) => CompletionResult | null {
	const defaultSchema = isSqlite ? '' : 'public'

	return (context: CompletionContext): CompletionResult | null => {
		const textBefore = context.state.sliceDoc(0, context.pos)

		// Only activate after a JOIN keyword
		const joinCtx = detectJoinContext(textBefore)
		if (!joinCtx) return null

		const schemaData = connectionsStore.getSchemaData(connectionId, database)
		if (!schemaData) return null

		// Parse all table references before the current JOIN
		const textBeforeJoin = textBefore.slice(0, joinCtx.from)
		const tableRefs = parseTableReferences(textBeforeJoin)
		if (tableRefs.length === 0) return null

		const completions = buildJoinCompletions(
			tableRefs,
			schemaData,
			isSqlite,
			defaultSchema,
		)
		if (completions.length === 0) return null

		return {
			from: joinCtx.from,
			options: completions,
			filter: true,
		}
	}
}
