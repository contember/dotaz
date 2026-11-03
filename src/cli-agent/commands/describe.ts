import { usageError } from '../errors'
import type { Section } from '../format'
import { requireTable, resolvePath } from '../paths'
import type { Command } from './types'

export const describeCommand: Command = {
	name: 'describe',
	flags: {},
	help: {
		usage: 'describe <connection[/database][/schema]/table>',
		summary: 'show columns, primary key, indexes and foreign keys in both directions',
	},
	async run(ctx) {
		const [path, ...extra] = ctx.args.positionals
		if (!path) throw usageError('describe requires a table path', 'Example: dotaz describe prod/app/public/orders')
		if (extra.length > 0) throw usageError('describe takes exactly one path')

		const resolved = requireTable(await resolvePath(path, ctx.app), path)
		const schemaData = resolved.schemaData ?? await ctx.app.loadSchema(resolved.connection.id, resolved.database)
		const key = `${resolved.schema}.${resolved.table}`

		const info = (schemaData.tables[resolved.schema] ?? []).find((t) => t.name === resolved.table)
		const columns = schemaData.columns[key] ?? []
		const indexes = schemaData.indexes[key] ?? []
		const foreignKeys = schemaData.foreignKeys[key] ?? []
		const referencedBy = schemaData.referencingForeignKeys[key] ?? []
		const primaryKey = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)

		const columnRows = columns.map((c) => ({
			column: c.name,
			type: c.dataType,
			nullable: c.nullable,
			default: c.defaultValue,
			pk: c.isPrimaryKey,
			auto: c.isAutoIncrement,
			maxLength: c.maxLength ?? null,
		}))
		const indexRows = indexes.map((i) => ({ index: i.name, columns: i.columns.join(', '), unique: i.isUnique, primary: i.isPrimary }))
		const fkRows = foreignKeys.map((f) => ({
			constraint: f.name,
			columns: f.columns.join(', '),
			references: `${f.referencedSchema}.${f.referencedTable}(${f.referencedColumns.join(', ')})`,
			onUpdate: f.onUpdate,
			onDelete: f.onDelete,
		}))
		const refRows = referencedBy.map((r) => ({
			constraint: r.constraintName,
			from: `${r.referencingSchema}.${r.referencingTable}(${r.referencingColumns.join(', ')})`,
			to: r.referencedColumns.join(', '),
		}))

		const sections: Section[] = [
			{
				kind: 'kv',
				columns: [{ name: 'connection' }, { name: 'database' }, { name: 'schema' }, { name: 'table' }, { name: 'type' }, { name: 'rowCount' }, {
					name: 'primaryKey',
				}],
				rows: [{
					connection: resolved.connection.name,
					database: resolved.database ?? null,
					schema: resolved.schema,
					table: resolved.table,
					type: info?.type ?? 'table',
					rowCount: info?.rowCount ?? null,
					primaryKey: primaryKey.length > 0 ? primaryKey.join(', ') : null,
				}],
			},
			{
				title: 'Columns',
				columns: [{ name: 'column' }, { name: 'type' }, { name: 'nullable' }, { name: 'default' }, { name: 'pk' }, { name: 'auto' }, {
					name: 'maxLength',
				}],
				rows: columnRows,
				empty: '(no columns)',
			},
			{
				title: 'Indexes',
				columns: [{ name: 'index' }, { name: 'columns' }, { name: 'unique' }, { name: 'primary' }],
				rows: indexRows,
				empty: '(none)',
			},
			{
				title: 'Foreign keys',
				columns: [{ name: 'constraint' }, { name: 'columns' }, { name: 'references' }, { name: 'onUpdate' }, { name: 'onDelete' }],
				rows: fkRows,
				empty: '(none)',
			},
			{
				title: 'Referenced by',
				columns: [{ name: 'constraint' }, { name: 'from' }, { name: 'to' }],
				rows: refRows,
				empty: '(none)',
			},
		]

		return {
			output: {
				sections,
				json: {
					connection: { id: resolved.connection.id, name: resolved.connection.name, type: resolved.connection.type },
					database: resolved.database,
					schema: resolved.schema,
					table: resolved.table,
					tableType: info?.type ?? 'table',
					rowCount: info?.rowCount,
					primaryKey,
					columns,
					indexes,
					foreignKeys,
					referencedBy,
				},
			},
		}
	},
}
