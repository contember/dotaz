import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { connectionsStore } from '../stores/connections'
import { parseTableReferences } from './join-completion'

/**
 * Resolve a table alias or name to a "schema.table" key in SchemaData.
 */
export function resolveTableKey(
	alias: string,
	textBefore: string,
	defaultSchema: string,
): string | null {
	const refs = parseTableReferences(textBefore)

	// Check if the identifier matches an alias
	for (const ref of refs) {
		if (ref.alias?.toLowerCase() === alias.toLowerCase()) {
			const schema = ref.schema ?? defaultSchema
			return `${schema}.${ref.table}`
		}
	}

	// Check if it matches a table name directly (unqualified)
	for (const ref of refs) {
		if (ref.table.toLowerCase() === alias.toLowerCase() && !ref.schema) {
			return `${defaultSchema}.${ref.table}`
		}
	}

	// Check if it's a schema-qualified reference (handled by CodeMirror's built-in)
	return null
}

/**
 * Parse CTE names from the SQL text.
 * Matches: WITH name AS (...), name2 AS (...)
 */
export function parseCteNames(text: string): string[] {
	const names: string[] = []
	// Match WITH or comma-separated CTE definitions
	const ctePattern = /\bWITH\s+(?:RECURSIVE\s+)?/gi
	const match = ctePattern.exec(text)
	if (!match) return names

	// From the WITH keyword, find all "name AS" patterns before the final SELECT
	const afterWith = text.slice(match.index + match[0].length)
	const namePattern = /(\w+)\s+AS\s*\(/gi
	let nameMatch: RegExpExecArray | null
	while ((nameMatch = namePattern.exec(afterWith)) !== null) {
		names.push(nameMatch[1])
	}
	return names
}

/**
 * Create a CodeMirror completion source for alias-aware column completion.
 *
 * When the user types `alias.` (dot after a table alias or name),
 * this suggests columns from the referenced table.
 * Also completes CTE names as table references.
 */
export function createAliasCompletionSource(
	connectionId: string,
	database: string | undefined,
	isSqlite: boolean,
): (context: CompletionContext) => CompletionResult | null {
	const defaultSchema = isSqlite ? 'main' : 'public'

	return (context: CompletionContext): CompletionResult | null => {
		const textBefore = context.state.sliceDoc(0, context.pos)

		// Case 1: alias.column — dot-triggered column completion
		const dotMatch = textBefore.match(/(\w+)\.(\w*)$/)
		if (dotMatch) {
			const alias = dotMatch[1]
			const partial = dotMatch[2]
			const from = context.pos - partial.length

			const schemaData = connectionsStore.getSchemaData(connectionId, database)
			if (!schemaData) return null

			const tableKey = resolveTableKey(alias, textBefore, defaultSchema)
			if (!tableKey) return null

			const columns = schemaData.columns[tableKey]
			if (!columns || columns.length === 0) return null

			return {
				from,
				options: columns.map((col) => ({
					label: col.name,
					type: col.isPrimaryKey ? 'property' : 'text',
					detail: col.dataType + (col.isPrimaryKey ? ' (PK)' : '') + (col.nullable ? '' : ' NOT NULL'),
					boost: col.isPrimaryKey ? 5 : 0,
				})),
			}
		}

		// Case 2: CTE name completion — suggest CTEs as table names
		// Only when typing an identifier (not after dot)
		const wordMatch = textBefore.match(/\b(\w+)$/)
		if (wordMatch && wordMatch[1].length >= 2) {
			const cteNames = parseCteNames(context.state.doc.toString())
			if (cteNames.length === 0) return null

			// Only suggest CTEs after FROM or JOIN keywords
			const beforeWord = textBefore.slice(0, textBefore.length - wordMatch[1].length)
			const afterKeyword = beforeWord.match(/\b(?:FROM|JOIN)\s+$/i)
			if (!afterKeyword) return null

			return {
				from: context.pos - wordMatch[1].length,
				options: cteNames.map((name) => ({
					label: name,
					type: 'keyword',
					detail: 'CTE',
					boost: 20,
				})),
				filter: true,
			}
		}

		return null
	}
}
