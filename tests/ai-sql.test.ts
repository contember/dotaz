import { describe, expect, test } from 'bun:test'
import { buildSchemaContext } from '../src/backend-shared/services/ai-sql'
import type { SchemaData } from '../src/shared/types/database'
import { DatabaseDataType } from '../src/shared/types/database'

describe('buildSchemaContext', () => {
	test('generates context for tables with columns and FKs', () => {
		const schema: SchemaData = {
			schemas: [{ name: 'public' }],
			tables: {
				public: [
					{ schema: 'public', name: 'users', type: 'table' },
					{ schema: 'public', name: 'orders', type: 'table' },
				],
			},
			columns: {
				'public.users': [
					{ name: 'id', dataType: DatabaseDataType.Serial, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: true },
					{ name: 'name', dataType: DatabaseDataType.Text, nullable: false, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false },
					{ name: 'email', dataType: DatabaseDataType.Varchar, nullable: true, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false },
				],
				'public.orders': [
					{ name: 'id', dataType: DatabaseDataType.Serial, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: true },
					{ name: 'user_id', dataType: DatabaseDataType.Integer, nullable: false, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false },
					{ name: 'total', dataType: DatabaseDataType.Numeric, nullable: false, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false },
				],
			},
			indexes: {},
			foreignKeys: {
				'public.users': [],
				'public.orders': [
					{
						name: 'fk_orders_user',
						columns: ['user_id'],
						referencedSchema: 'public',
						referencedTable: 'users',
						referencedColumns: ['id'],
						onUpdate: 'NO ACTION',
						onDelete: 'CASCADE',
					},
				],
			},
			referencingForeignKeys: {},
		}

		const context = buildSchemaContext(schema)

		expect(context).toContain('TABLE users')
		expect(context).toContain('id serial PK NOT NULL AUTO_INCREMENT')
		expect(context).toContain('name text NOT NULL')
		expect(context).toContain('email varchar')
		expect(context).toContain('TABLE orders')
		expect(context).toContain('user_id integer NOT NULL')
		expect(context).toContain('FK user_id -> users(id)')
	})

	test('uses qualified names for non-public schemas', () => {
		const schema: SchemaData = {
			schemas: [{ name: 'analytics' }],
			tables: {
				analytics: [
					{ schema: 'analytics', name: 'events', type: 'table' },
				],
			},
			columns: {
				'analytics.events': [
					{ name: 'id', dataType: DatabaseDataType.Integer, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: false },
				],
			},
			indexes: {},
			foreignKeys: { 'analytics.events': [] },
			referencingForeignKeys: {},
		}

		const context = buildSchemaContext(schema)
		expect(context).toContain('TABLE analytics.events')
	})

	test('respects maxTables limit', () => {
		const tables = Array.from({ length: 100 }, (_, i) => ({
			schema: 'public',
			name: `table_${i}`,
			type: 'table' as const,
		}))
		const columns: Record<string, any[]> = {}
		const foreignKeys: Record<string, any[]> = {}
		for (const t of tables) {
			columns[`public.${t.name}`] = [
				{ name: 'id', dataType: DatabaseDataType.Integer, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: false },
			]
			foreignKeys[`public.${t.name}`] = []
		}

		const schema: SchemaData = {
			schemas: [{ name: 'public' }],
			tables: { public: tables },
			columns,
			indexes: {},
			foreignKeys,
			referencingForeignKeys: {},
		}

		const context = buildSchemaContext(schema, 5)
		const tableLines = context.split('\n').filter((l) => l.startsWith('TABLE '))
		expect(tableLines.length).toBe(5)
	})

	test('handles empty schema', () => {
		const schema: SchemaData = {
			schemas: [],
			tables: {},
			columns: {},
			indexes: {},
			foreignKeys: {},
			referencingForeignKeys: {},
		}

		const context = buildSchemaContext(schema)
		expect(context).toBe('')
	})

	test('uses unqualified name for main schema (SQLite)', () => {
		const schema: SchemaData = {
			schemas: [{ name: 'main' }],
			tables: {
				main: [
					{ schema: 'main', name: 'items', type: 'table' },
				],
			},
			columns: {
				'main.items': [
					{ name: 'id', dataType: DatabaseDataType.Integer, nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: false },
				],
			},
			indexes: {},
			foreignKeys: { 'main.items': [] },
			referencingForeignKeys: {},
		}

		const context = buildSchemaContext(schema)
		expect(context).toContain('TABLE items')
		expect(context).not.toContain('TABLE main.items')
	})
})
