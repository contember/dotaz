import type { SchemaData } from '@dotaz/shared/types/database'
import type { CliConnection } from '../decode'
import { usageError } from '../errors'
import type { CommandOutput } from '../output'
import { type ResolvedPath, resolvePath } from '../paths'
import type { Command } from './types'

function connectionsOutput(connections: CliConnection[]): CommandOutput {
	const rows = connections.map((c) => ({
		name: c.name,
		id: c.id,
		type: c.type,
		state: c.state,
		readOnly: c.readOnly,
		group: c.groupName ?? null,
	}))
	return {
		sections: [{
			columns: [{ name: 'name' }, { name: 'id' }, { name: 'type' }, { name: 'state' }, { name: 'readOnly' }, { name: 'group' }],
			rows,
			empty: '(no connections configured)',
		}],
		json: { level: 'connection', rows },
	}
}

function schemasOutput(schemaData: SchemaData): CommandOutput {
	const rows = schemaData.schemas.map((s) => ({ schema: s.name, tables: (schemaData.tables[s.name] ?? []).length }))
	return {
		sections: [{ columns: [{ name: 'schema' }, { name: 'tables' }], rows, empty: '(no schemas)' }],
		json: { level: 'schema', rows },
	}
}

function tablesOutput(schemaData: SchemaData, schema: string): CommandOutput {
	const rows = (schemaData.tables[schema] ?? []).map((t) => ({
		table: t.name,
		type: t.type,
		rows: t.rowCount ?? null,
	}))
	return {
		sections: [{ columns: [{ name: 'table' }, { name: 'type' }, { name: 'rows' }], rows, empty: '(no tables)' }],
		json: { level: 'table', schema, rows },
	}
}

function columnsOutput(schemaData: SchemaData, schema: string, table: string): CommandOutput {
	const rows = (schemaData.columns[`${schema}.${table}`] ?? []).map((c) => ({
		column: c.name,
		type: c.dataType,
		nullable: c.nullable,
		pk: c.isPrimaryKey,
	}))
	return {
		sections: [{ columns: [{ name: 'column' }, { name: 'type' }, { name: 'nullable' }, { name: 'pk' }], rows, empty: '(no columns)' }],
		json: { level: 'column', schema, table, rows },
	}
}

/** Single-schema drivers (SQLite, MySQL) skip the schema listing — it would always have one row. */
function schemaOrTables(schemaData: SchemaData): CommandOutput {
	if (schemaData.schemas.length === 1) return tablesOutput(schemaData, schemaData.schemas[0].name)
	return schemasOutput(schemaData)
}

export const lsCommand: Command = {
	name: 'ls',
	flags: {},
	help: {
		usage: 'ls [connection[/database[/schema[/table]]]]',
		summary: 'list connections, databases, schemas, tables or columns',
		notes: ['With no path it lists connections; each extra segment descends one level.'],
	},
	async run(ctx) {
		const [path, ...extra] = ctx.args.positionals
		if (extra.length > 0) throw usageError(`ls takes at most one path, got ${extra.length + 1}`)

		const resolved: ResolvedPath | null = await resolvePath(path, ctx.app)
		if (!resolved) return { output: connectionsOutput(await ctx.app.listConnections()) }

		switch (resolved.level) {
			case 'connection': {
				if (resolved.connection.type === 'sqlite') {
					return { output: schemaOrTables(await ctx.app.loadSchema(resolved.connection.id)) }
				}
				const databases = await ctx.app.listDatabases(resolved.connection.id)
				const rows = databases.map((d) => ({ database: d.name, default: d.isDefault, active: d.isActive }))
				return {
					output: {
						sections: [{ columns: [{ name: 'database' }, { name: 'default' }, { name: 'active' }], rows, empty: '(no databases)' }],
						json: { level: 'database', rows },
					},
				}
			}
			case 'database':
				return { output: schemaOrTables(await ctx.app.loadSchema(resolved.connection.id, resolved.database)) }
			case 'schema': {
				const schemaData = resolved.schemaData ?? await ctx.app.loadSchema(resolved.connection.id, resolved.database)
				return { output: tablesOutput(schemaData, resolved.schema ?? '') }
			}
			case 'table': {
				const schemaData = resolved.schemaData ?? await ctx.app.loadSchema(resolved.connection.id, resolved.database)
				return { output: columnsOutput(schemaData, resolved.schema ?? '', resolved.table ?? '') }
			}
		}
	},
}
