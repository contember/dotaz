import type { SchemaData } from '@dotaz/shared/types/database'
import type { IdentifierAtCursor } from './sql-identifier-at'

export interface ResolvedTable {
	schema: string
	table: string
	type: 'table' | 'view' | 'materialized-view'
}

/**
 * Resolve a parsed identifier against the connection's schema cache.
 *
 * Match priority:
 *   1. Exact schema-qualified match if the identifier was written as `schema.name`.
 *   2. Case-insensitive same-schema match.
 *   3. Otherwise, search every schema for an unqualified hit (case-insensitive).
 *      Returns a match only if exactly one schema has it — ambiguity = no nav.
 */
export function resolveIdentifierToTable(
	ident: IdentifierAtCursor,
	schemaData: SchemaData | undefined,
): ResolvedTable | null {
	if (!schemaData) return null

	if (ident.schema) {
		const tables = schemaData.tables[ident.schema]
			?? schemaData.tables[findSchemaCi(schemaData, ident.schema) ?? '']
		if (!tables) return null
		const t = tables.find((tab) => tab.name === ident.name) ?? tables.find((tab) => tab.name.toLowerCase() === ident.name.toLowerCase())
		return t ? { schema: t.schema, table: t.name, type: t.type } : null
	}

	const hits: ResolvedTable[] = []
	for (const schemaName of Object.keys(schemaData.tables)) {
		const tables = schemaData.tables[schemaName]
		const exact = tables.find((t) => t.name === ident.name)
		if (exact) {
			hits.push({ schema: exact.schema, table: exact.name, type: exact.type })
			continue
		}
		const ci = tables.find((t) => t.name.toLowerCase() === ident.name.toLowerCase())
		if (ci) hits.push({ schema: ci.schema, table: ci.name, type: ci.type })
	}

	if (hits.length === 1) return hits[0]
	// Prefer 'public' if multiple schemas matched
	if (hits.length > 1) {
		const pub = hits.find((h) => h.schema === 'public')
		if (pub) return pub
	}
	return null
}

function findSchemaCi(schemaData: SchemaData, name: string): string | undefined {
	const target = name.toLowerCase()
	return schemaData.schemas.find((s) => s.name.toLowerCase() === target)?.name
}
