// `connection/database/schema/table` path parsing and resolution.
// Resolution takes an injectable context so it can be tested without a running app.

import type { DatabaseInfo, SchemaData } from '@dotaz/shared/types/database'
import type { CliConnection } from './decode'
import { usageError } from './errors'

export type PathLevel = 'connection' | 'database' | 'schema' | 'table'

export interface ResolvedPath {
	connection: CliConnection
	database?: string
	schema?: string
	table?: string
	level: PathLevel
	/** Loaded only when the path reached the schema/table level. */
	schemaData?: SchemaData
}

export interface ResolverContext {
	listConnections(): Promise<CliConnection[]>
	listDatabases(connectionId: string): Promise<DatabaseInfo[]>
	loadSchema(connectionId: string, database?: string): Promise<SchemaData>
}

export function splitPath(raw: string): string[] {
	const segments = raw.split('/')
	// A trailing slash is a typo, not an empty segment
	if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop()
	if (segments.some((s) => s.length === 0)) throw usageError(`Invalid path "${raw}" — empty segment`)
	return segments
}

function listNames(values: string[], limit = 12): string {
	const shown = values.slice(0, limit)
	const suffix = values.length > limit ? `, … (${values.length} total)` : ''
	return shown.join(', ') + suffix
}

/** A connection is matched by id, by exact name, or by a unique case-insensitive prefix. */
export function resolveConnectionRef(connections: CliConnection[], ref: string): CliConnection {
	if (connections.length === 0) {
		throw usageError('No connections are configured in Dotaz', 'Add a connection in the app first.')
	}

	const byId = connections.find((c) => c.id === ref)
	if (byId) return byId

	const exactName = connections.filter((c) => c.name === ref)
	if (exactName.length === 1) return exactName[0]
	if (exactName.length > 1) {
		throw usageError(`Connection name "${ref}" is ambiguous`, `Use the connection id instead: ${listNames(exactName.map((c) => c.id))}`)
	}

	const lower = ref.toLowerCase()
	const caseInsensitive = connections.filter((c) => c.name.toLowerCase() === lower)
	if (caseInsensitive.length === 1) return caseInsensitive[0]
	if (caseInsensitive.length > 1) {
		throw usageError(`Connection name "${ref}" is ambiguous`, `Use the connection id instead: ${listNames(caseInsensitive.map((c) => c.id))}`)
	}

	const prefix = connections.filter((c) => c.name.toLowerCase().startsWith(lower))
	if (prefix.length === 1) return prefix[0]
	if (prefix.length > 1) {
		throw usageError(`Connection prefix "${ref}" is ambiguous`, `Matches: ${listNames(prefix.map((c) => c.name))}`)
	}

	throw usageError(`Unknown connection "${ref}"`, `Available: ${listNames(connections.map((c) => c.name))}`)
}

export function resolveDatabaseRef(databases: DatabaseInfo[], ref: string): string {
	// Some drivers cannot enumerate databases — trust the caller rather than block them
	if (databases.length === 0) return ref
	const exact = databases.find((d) => d.name === ref)
	if (exact) return exact.name
	const lower = ref.toLowerCase()
	const matches = databases.filter((d) => d.name.toLowerCase() === lower)
	if (matches.length === 1) return matches[0].name
	throw usageError(`Unknown database "${ref}"`, `Available: ${listNames(databases.map((d) => d.name))}`)
}

function findSchema(schemaData: SchemaData, ref: string): string | null {
	const exact = schemaData.schemas.find((s) => s.name === ref)
	if (exact) return exact.name
	const lower = ref.toLowerCase()
	const matches = schemaData.schemas.filter((s) => s.name.toLowerCase() === lower)
	return matches.length === 1 ? matches[0].name : null
}

function findTable(schemaData: SchemaData, schema: string, ref: string): string | null {
	const tables = schemaData.tables[schema] ?? []
	const exact = tables.find((t) => t.name === ref)
	if (exact) return exact.name
	const lower = ref.toLowerCase()
	const matches = tables.filter((t) => t.name.toLowerCase() === lower)
	return matches.length === 1 ? matches[0].name : null
}

/** Resolve the `[schema/]table` tail. The schema is optional on single-schema drivers (SQLite, MySQL). */
export function resolveSchemaTable(schemaData: SchemaData, segments: string[], pathLabel: string): { schema?: string; table?: string } {
	if (segments.length === 0) return {}

	if (segments.length > 2) {
		throw usageError(`Path "${pathLabel}" has too many segments`, 'Expected connection[/database][/schema]/table')
	}

	if (segments.length === 2) {
		const schema = findSchema(schemaData, segments[0])
		if (!schema) {
			throw usageError(`Unknown schema "${segments[0]}"`, `Available: ${listNames(schemaData.schemas.map((s) => s.name))}`)
		}
		const table = findTable(schemaData, schema, segments[1])
		if (!table) {
			throw usageError(
				`Unknown table "${segments[1]}" in schema "${schema}"`,
				`Available: ${listNames((schemaData.tables[schema] ?? []).map((t) => t.name))}`,
			)
		}
		return { schema, table }
	}

	const asSchema = findSchema(schemaData, segments[0])
	if (asSchema) return { schema: asSchema }

	// Shortened form: `connection/table` on drivers without a schema layer
	const hits: { schema: string; table: string }[] = []
	for (const schema of schemaData.schemas) {
		const table = findTable(schemaData, schema.name, segments[0])
		if (table) hits.push({ schema: schema.name, table })
	}
	if (hits.length === 1) return hits[0]
	if (hits.length > 1) {
		throw usageError(
			`Table "${segments[0]}" exists in several schemas`,
			`Qualify it: ${listNames(hits.map((h) => `${h.schema}/${h.table}`))}`,
		)
	}
	throw usageError(
		`No schema or table named "${segments[0]}"`,
		`Schemas: ${listNames(schemaData.schemas.map((s) => s.name))}`,
	)
}

function levelFor(resolved: { schema?: string; table?: string }, base: PathLevel): PathLevel {
	if (resolved.table) return 'table'
	if (resolved.schema) return 'schema'
	return base
}

/** Resolve a full object path. `raw === undefined` means "the connection list". */
export async function resolvePath(raw: string | undefined, ctx: ResolverContext): Promise<ResolvedPath | null> {
	if (raw === undefined) return null

	const segments = splitPath(raw)
	const connections = await ctx.listConnections()
	const connection = resolveConnectionRef(connections, segments[0])
	const rest = segments.slice(1)

	if (connection.type === 'sqlite') {
		if (rest.length === 0) return { connection, level: 'connection' }
		const schemaData = await ctx.loadSchema(connection.id)
		const tail = resolveSchemaTable(schemaData, rest, raw)
		return { connection, ...tail, level: levelFor(tail, 'connection'), schemaData }
	}

	if (rest.length === 0) return { connection, level: 'connection' }

	const database = resolveDatabaseRef(await ctx.listDatabases(connection.id), rest[0])
	const tail = rest.slice(1)
	if (tail.length === 0) return { connection, database, level: 'database' }

	const schemaData = await ctx.loadSchema(connection.id, database)
	const resolved = resolveSchemaTable(schemaData, tail, raw)
	return { connection, database, ...resolved, level: levelFor(resolved, 'database'), schemaData }
}

export interface ResolvedScope {
	connection: CliConnection
	database?: string
}

/** Resolve the `connection[/database]` form used by query/explain/search/propose/ui console. */
export async function resolveScope(raw: string, ctx: ResolverContext): Promise<ResolvedScope> {
	const segments = splitPath(raw)
	const connections = await ctx.listConnections()
	const connection = resolveConnectionRef(connections, segments[0])

	if (segments.length === 1) return { connection }
	if (segments.length > 2) {
		throw usageError(`Path "${raw}" has too many segments`, 'Expected connection[/database]')
	}
	if (connection.type === 'sqlite') {
		throw usageError(`SQLite connection "${connection.name}" has no database segment`, `Use "${segments[0]}" on its own.`)
	}
	return { connection, database: resolveDatabaseRef(await ctx.listDatabases(connection.id), segments[1]) }
}

/** Narrow a resolved path to a table, failing with an actionable message when it is not one. */
export function requireTable(resolved: ResolvedPath | null, pathLabel: string): ResolvedPath & { schema: string; table: string } {
	if (!resolved?.table || resolved.schema === undefined) {
		throw usageError(`"${pathLabel}" does not point at a table`, 'Expected connection[/database][/schema]/table')
	}
	const { schema, table } = resolved
	return { ...resolved, schema, table }
}
