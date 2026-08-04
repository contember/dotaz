import type { DatabaseInfo, SchemaData } from '@dotaz/shared/types/database'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import { describe, expect, test } from 'bun:test'
import type { CliConnection } from '../src/cli-agent/decode'
import { CliError, EXIT } from '../src/cli-agent/errors'
import {
	requireTable,
	resolveConnectionRef,
	resolveDatabaseRef,
	resolvePath,
	type ResolverContext,
	resolveScope,
	splitPath,
} from '../src/cli-agent/paths'

const CONNECTIONS: CliConnection[] = [
	{ id: 'c-prod', name: 'production', type: 'postgresql', state: 'connected', readOnly: false },
	{ id: 'c-prodigy', name: 'prodigy', type: 'postgresql', state: 'disconnected', readOnly: false },
	{ id: 'c-shop', name: 'shop', type: 'mysql', state: 'connected', readOnly: false },
	{ id: 'c-notes', name: 'notes', type: 'sqlite', state: 'connected', readOnly: false },
	{ id: 'c-dup-a', name: 'twin', type: 'postgresql', state: 'connected', readOnly: false },
	{ id: 'c-dup-b', name: 'twin', type: 'postgresql', state: 'connected', readOnly: false },
]

function emptySchema(): SchemaData {
	return { schemas: [], tables: {}, columns: {}, indexes: {}, foreignKeys: {}, referencingForeignKeys: {} }
}

function schemaWith(tables: Record<string, string[]>): SchemaData {
	const data = emptySchema()
	data.schemas = Object.keys(tables).map((name) => ({ name }))
	for (const [schema, names] of Object.entries(tables)) {
		data.tables[schema] = names.map((name) => ({ schema, name, type: 'table' as const }))
		for (const name of names) {
			data.columns[`${schema}.${name}`] = [
				{ name: 'id', dataType: DatabaseDataType.Integer, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: true },
			]
		}
	}
	return data
}

const SCHEMAS: Record<string, SchemaData> = {
	'c-prod app': schemaWith({ public: ['orders', 'users'], billing: ['invoices', 'users'] }),
	'c-shop shopdb': schemaWith({ shopdb: ['items', 'carts'] }),
	'c-notes ': schemaWith({ main: ['tasks', 'tags'] }),
}

const DATABASES: Record<string, DatabaseInfo[]> = {
	'c-prod': [{ name: 'app', isDefault: true, isActive: true }, { name: 'analytics', isDefault: false, isActive: false }],
	'c-prodigy': [],
	'c-shop': [{ name: 'shopdb', isDefault: true, isActive: true }],
}

const ctx: ResolverContext = {
	async listConnections() {
		return CONNECTIONS
	},
	async listDatabases(connectionId) {
		return DATABASES[connectionId] ?? []
	},
	async loadSchema(connectionId, database) {
		return SCHEMAS[`${connectionId} ${database ?? ''}`] ?? emptySchema()
	},
}

async function exitCodeOf(fn: () => unknown | Promise<unknown>): Promise<number | undefined> {
	try {
		await fn()
		return undefined
	} catch (err) {
		return err instanceof CliError ? err.exitCode : undefined
	}
}

describe('splitPath', () => {
	test('splits on slashes', () => {
		expect(splitPath('a/b/c')).toEqual(['a', 'b', 'c'])
	})

	test('tolerates one trailing slash', () => {
		expect(splitPath('a/b/')).toEqual(['a', 'b'])
	})

	test('rejects empty segments', async () => {
		expect(await exitCodeOf(() => splitPath('a//b'))).toBe(EXIT.usage)
	})
})

describe('resolveConnectionRef', () => {
	test('matches by id', () => {
		expect(resolveConnectionRef(CONNECTIONS, 'c-notes').name).toBe('notes')
	})

	test('matches by exact name', () => {
		expect(resolveConnectionRef(CONNECTIONS, 'production').id).toBe('c-prod')
	})

	test('matches by case-insensitive exact name', () => {
		expect(resolveConnectionRef(CONNECTIONS, 'PRODUCTION').id).toBe('c-prod')
	})

	test('matches by unique case-insensitive prefix', () => {
		expect(resolveConnectionRef(CONNECTIONS, 'no').id).toBe('c-notes')
		expect(resolveConnectionRef(CONNECTIONS, 'shO').id).toBe('c-shop')
	})

	test('an ambiguous prefix is a usage error', async () => {
		expect(await exitCodeOf(() => resolveConnectionRef(CONNECTIONS, 'prod'))).toBe(EXIT.usage)
	})

	test('duplicate names are a usage error pointing at ids', async () => {
		let hint: string | undefined
		try {
			resolveConnectionRef(CONNECTIONS, 'twin')
		} catch (err) {
			hint = err instanceof CliError ? err.hint : undefined
		}
		expect(hint).toContain('c-dup-a')
		expect(hint).toContain('c-dup-b')
	})

	test('unknown connection is a usage error', async () => {
		expect(await exitCodeOf(() => resolveConnectionRef(CONNECTIONS, 'nope'))).toBe(EXIT.usage)
	})

	test('no connections at all is a usage error', async () => {
		expect(await exitCodeOf(() => resolveConnectionRef([], 'anything'))).toBe(EXIT.usage)
	})
})

describe('resolveDatabaseRef', () => {
	test('matches exactly and case-insensitively', () => {
		expect(resolveDatabaseRef(DATABASES['c-prod'], 'app')).toBe('app')
		expect(resolveDatabaseRef(DATABASES['c-prod'], 'APP')).toBe('app')
	})

	test('passes through when the driver lists no databases', () => {
		expect(resolveDatabaseRef([], 'whatever')).toBe('whatever')
	})

	test('unknown database is a usage error', async () => {
		expect(await exitCodeOf(() => resolveDatabaseRef(DATABASES['c-prod'], 'nope'))).toBe(EXIT.usage)
	})
})

describe('resolvePath', () => {
	test('no path means the connection list', async () => {
		expect(await resolvePath(undefined, ctx)).toBeNull()
	})

	test('connection level', async () => {
		const resolved = await resolvePath('production', ctx)
		expect(resolved?.level).toBe('connection')
		expect(resolved?.database).toBeUndefined()
	})

	test('database level', async () => {
		const resolved = await resolvePath('production/app', ctx)
		expect(resolved?.level).toBe('database')
		expect(resolved?.database).toBe('app')
	})

	test('schema level', async () => {
		const resolved = await resolvePath('production/app/public', ctx)
		expect(resolved?.level).toBe('schema')
		expect(resolved?.schema).toBe('public')
		expect(resolved?.table).toBeUndefined()
	})

	test('table level', async () => {
		const resolved = await resolvePath('production/app/public/orders', ctx)
		expect(resolved?.level).toBe('table')
		expect(resolved?.schema).toBe('public')
		expect(resolved?.table).toBe('orders')
	})

	test('SQLite accepts the shortened connection/table form', async () => {
		const resolved = await resolvePath('notes/tasks', ctx)
		expect(resolved?.level).toBe('table')
		expect(resolved?.schema).toBe('main')
		expect(resolved?.table).toBe('tasks')
	})

	test('SQLite also accepts the explicit schema', async () => {
		const resolved = await resolvePath('notes/main/tags', ctx)
		expect(resolved?.table).toBe('tags')
	})

	test('MySQL skips the schema segment because there is only one', async () => {
		const resolved = await resolvePath('shop/shopdb/items', ctx)
		expect(resolved?.level).toBe('table')
		expect(resolved?.schema).toBe('shopdb')
		expect(resolved?.table).toBe('items')
	})

	test('a table present in several schemas must be qualified', async () => {
		expect(await exitCodeOf(() => resolvePath('production/app/users', ctx))).toBe(EXIT.usage)
	})

	test('unknown schema or table is a usage error', async () => {
		expect(await exitCodeOf(() => resolvePath('production/app/nope', ctx))).toBe(EXIT.usage)
		expect(await exitCodeOf(() => resolvePath('production/app/public/nope', ctx))).toBe(EXIT.usage)
	})

	test('too many segments is a usage error', async () => {
		expect(await exitCodeOf(() => resolvePath('production/app/public/orders/extra', ctx))).toBe(EXIT.usage)
	})
})

describe('resolveScope', () => {
	test('connection only', async () => {
		const scope = await resolveScope('production', ctx)
		expect(scope.connection.id).toBe('c-prod')
		expect(scope.database).toBeUndefined()
	})

	test('connection with database', async () => {
		expect((await resolveScope('production/analytics', ctx)).database).toBe('analytics')
	})

	test('SQLite rejects a database segment', async () => {
		expect(await exitCodeOf(() => resolveScope('notes/main', ctx))).toBe(EXIT.usage)
	})

	test('more than two segments is a usage error', async () => {
		expect(await exitCodeOf(() => resolveScope('production/app/public', ctx))).toBe(EXIT.usage)
	})
})

describe('requireTable', () => {
	test('passes a table path through', async () => {
		const resolved = await resolvePath('notes/tasks', ctx)
		expect(requireTable(resolved, 'notes/tasks').table).toBe('tasks')
	})

	test('rejects a schema path', async () => {
		const resolved = await resolvePath('production/app/public', ctx)
		expect(await exitCodeOf(() => requireTable(resolved, 'production/app/public'))).toBe(EXIT.usage)
	})

	test('rejects a null path', async () => {
		expect(await exitCodeOf(() => requireTable(null, ''))).toBe(EXIT.usage)
	})
})
