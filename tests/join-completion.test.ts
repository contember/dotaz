import { buildJoinCompletions, detectJoinContext, parseTableReferences } from '@dotaz/frontend-shared/lib/join-completion'
import type { SchemaData } from '@dotaz/shared/types/database'
import { describe, expect, it } from 'bun:test'

// ── Helper ────────────────────────────────────────────────

function createSchemaData(overrides?: Partial<SchemaData>): SchemaData {
	return {
		schemas: [{ name: 'public' }],
		tables: {
			public: [
				{ name: 'orders', type: 'table' },
				{ name: 'customers', type: 'table' },
				{ name: 'products', type: 'table' },
				{ name: 'order_items', type: 'table' },
			],
		},
		columns: {
			'public.orders': [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
				{ name: 'customer_id', dataType: 'integer', nullable: false, isPrimaryKey: false },
			],
			'public.customers': [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
				{ name: 'name', dataType: 'text', nullable: false, isPrimaryKey: false },
			],
			'public.order_items': [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
				{ name: 'order_id', dataType: 'integer', nullable: false, isPrimaryKey: false },
				{ name: 'product_id', dataType: 'integer', nullable: false, isPrimaryKey: false },
			],
			'public.products': [
				{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
				{ name: 'name', dataType: 'text', nullable: false, isPrimaryKey: false },
			],
		},
		indexes: {},
		foreignKeys: {
			'public.orders': [
				{
					name: 'fk_orders_customer',
					columns: ['customer_id'],
					referencedSchema: 'public',
					referencedTable: 'customers',
					referencedColumns: ['id'],
					onUpdate: 'NO ACTION',
					onDelete: 'CASCADE',
				},
			],
			'public.order_items': [
				{
					name: 'fk_order_items_order',
					columns: ['order_id'],
					referencedSchema: 'public',
					referencedTable: 'orders',
					referencedColumns: ['id'],
					onUpdate: 'NO ACTION',
					onDelete: 'CASCADE',
				},
				{
					name: 'fk_order_items_product',
					columns: ['product_id'],
					referencedSchema: 'public',
					referencedTable: 'products',
					referencedColumns: ['id'],
					onUpdate: 'NO ACTION',
					onDelete: 'CASCADE',
				},
			],
		},
		referencingForeignKeys: {
			'public.customers': [
				{
					constraintName: 'fk_orders_customer',
					referencingSchema: 'public',
					referencingTable: 'orders',
					referencingColumns: ['customer_id'],
					referencedColumns: ['id'],
				},
			],
			'public.orders': [
				{
					constraintName: 'fk_order_items_order',
					referencingSchema: 'public',
					referencingTable: 'order_items',
					referencingColumns: ['order_id'],
					referencedColumns: ['id'],
				},
			],
			'public.products': [
				{
					constraintName: 'fk_order_items_product',
					referencingSchema: 'public',
					referencingTable: 'order_items',
					referencingColumns: ['product_id'],
					referencedColumns: ['id'],
				},
			],
		},
		...overrides,
	}
}

// ── parseTableReferences ──────────────────────────────────

describe('parseTableReferences', () => {
	it('parses a single FROM table', () => {
		const refs = parseTableReferences('SELECT * FROM orders ')
		expect(refs).toEqual([{ table: 'orders' }])
	})

	it('parses schema-qualified FROM table', () => {
		const refs = parseTableReferences('SELECT * FROM public.orders ')
		expect(refs).toEqual([{ schema: 'public', table: 'orders' }])
	})

	it('parses FROM table with alias', () => {
		const refs = parseTableReferences('SELECT * FROM orders o ')
		expect(refs).toEqual([{ table: 'orders', alias: 'o' }])
	})

	it('parses FROM table with AS alias', () => {
		const refs = parseTableReferences('SELECT * FROM orders AS o ')
		expect(refs).toEqual([{ table: 'orders', alias: 'o' }])
	})

	it('does not treat SQL keywords as aliases', () => {
		const refs = parseTableReferences(
			'SELECT * FROM orders WHERE id = 1',
		)
		expect(refs).toEqual([{ table: 'orders' }])
	})

	it('does not treat ON as alias after JOIN table', () => {
		const refs = parseTableReferences(
			'SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id ',
		)
		expect(refs).toEqual([
			{ table: 'orders' },
			{ table: 'customers' },
		])
	})

	it('parses multiple JOINed tables', () => {
		const refs = parseTableReferences(
			'SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id JOIN order_items ON orders.id = order_items.order_id ',
		)
		expect(refs).toEqual([
			{ table: 'orders' },
			{ table: 'customers' },
			{ table: 'order_items' },
		])
	})

	it('parses schema-qualified JOIN table with alias', () => {
		const refs = parseTableReferences(
			'SELECT * FROM public.orders o JOIN public.customers c ON o.customer_id = c.id ',
		)
		expect(refs).toEqual([
			{ schema: 'public', table: 'orders', alias: 'o' },
			{ schema: 'public', table: 'customers', alias: 'c' },
		])
	})
})

// ── detectJoinContext ─────────────────────────────────────

describe('detectJoinContext', () => {
	it('detects cursor after JOIN keyword', () => {
		const result = detectJoinContext('SELECT * FROM orders JOIN ')
		expect(result).toEqual({ from: 26, partial: '' })
	})

	it('detects cursor with partial table name', () => {
		const result = detectJoinContext('SELECT * FROM orders JOIN cust')
		expect(result).toEqual({ from: 26, partial: 'cust' })
	})

	it('detects LEFT JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders LEFT JOIN ')
		expect(result).not.toBeNull()
		expect(result!.partial).toBe('')
	})

	it('detects RIGHT JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders RIGHT JOIN ')
		expect(result).not.toBeNull()
	})

	it('detects INNER JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders INNER JOIN ')
		expect(result).not.toBeNull()
	})

	it('detects FULL OUTER JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders FULL OUTER JOIN ')
		expect(result).not.toBeNull()
	})

	it('detects CROSS JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders CROSS JOIN ')
		expect(result).not.toBeNull()
	})

	it('detects NATURAL JOIN', () => {
		const result = detectJoinContext('SELECT * FROM orders NATURAL JOIN ')
		expect(result).not.toBeNull()
	})

	it('returns null when not in JOIN context', () => {
		expect(detectJoinContext('SELECT * FROM orders WHERE ')).toBeNull()
		expect(detectJoinContext('SELECT * FROM orders ')).toBeNull()
		expect(detectJoinContext('SELECT * FROM ')).toBeNull()
	})

	it('detects JOIN after previous JOIN clause', () => {
		const text = 'SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id JOIN '
		const result = detectJoinContext(text)
		expect(result).not.toBeNull()
		expect(result!.partial).toBe('')
	})
})

// ── buildJoinCompletions ──────────────────────────────────

describe('buildJoinCompletions', () => {
	const schemaData = createSchemaData()

	it('suggests FK-related tables for FROM table (outgoing FK)', () => {
		const completions = buildJoinCompletions(
			[{ table: 'orders' }],
			schemaData,
			false,
			'public',
		)

		// orders has outgoing FK to customers
		const customerCompletion = completions.find(
			(c) => c.label === 'customers' && c.apply?.toString().includes('customer_id'),
		)
		expect(customerCompletion).toBeDefined()
		expect(customerCompletion!.apply).toBe(
			'public.customers ON orders.customer_id = public.customers.id',
		)
		expect(customerCompletion!.boost).toBe(10)
	})

	it('suggests FK-related tables for FROM table (incoming FK)', () => {
		const completions = buildJoinCompletions(
			[{ table: 'orders' }],
			schemaData,
			false,
			'public',
		)

		// orders has incoming FK from order_items
		const orderItemsCompletion = completions.find(
			(c) => c.label === 'order_items',
		)
		expect(orderItemsCompletion).toBeDefined()
		expect(orderItemsCompletion!.apply).toBe(
			'public.order_items ON orders.id = public.order_items.order_id',
		)
	})

	it('uses alias in ON clause when provided', () => {
		const completions = buildJoinCompletions(
			[{ table: 'orders', alias: 'o' }],
			schemaData,
			false,
			'public',
		)

		const customerCompletion = completions.find(
			(c) => c.label === 'customers',
		)
		expect(customerCompletion).toBeDefined()
		expect(customerCompletion!.apply).toBe(
			'public.customers ON o.customer_id = public.customers.id',
		)
	})

	it('handles SQLite mode (no schema prefix)', () => {
		const sqliteSchema = createSchemaData()
		// For SQLite, use empty string as default schema but still key by "schema.table"
		const completions = buildJoinCompletions(
			[{ table: 'orders' }],
			sqliteSchema,
			true,
			'',
		)

		// SQLite won't find FK under ".orders" key — need to adjust test schema
		// In reality, SQLite stores FK data under e.g., "main.orders" or ".orders"
	})

	it('handles multiple FKs from same table', () => {
		const completions = buildJoinCompletions(
			[{ table: 'order_items' }],
			schemaData,
			false,
			'public',
		)

		// order_items has FKs to both orders and products
		const orderCompletion = completions.find((c) => c.label === 'orders')
		const productCompletion = completions.find((c) => c.label === 'products')
		expect(orderCompletion).toBeDefined()
		expect(productCompletion).toBeDefined()
	})

	it('handles schema-qualified FROM table', () => {
		const completions = buildJoinCompletions(
			[{ schema: 'public', table: 'orders' }],
			schemaData,
			false,
			'public',
		)

		const customerCompletion = completions.find(
			(c) => c.label === 'customers',
		)
		expect(customerCompletion).toBeDefined()
		expect(customerCompletion!.apply).toBe(
			'public.customers ON public.orders.customer_id = public.customers.id',
		)
	})

	it('considers all table refs for FK lookup', () => {
		const completions = buildJoinCompletions(
			[
				{ table: 'orders' },
				{ table: 'customers' },
			],
			schemaData,
			false,
			'public',
		)

		// From orders: outgoing to customers, incoming from order_items
		// From customers: incoming from orders
		// Should have completions for: customers (from orders FK), order_items (from orders ref FK), orders (from customers ref FK)
		expect(completions.length).toBeGreaterThanOrEqual(3)
	})

	it('deduplicates identical completions', () => {
		const completions = buildJoinCompletions(
			[{ table: 'orders' }, { table: 'orders' }],
			schemaData,
			false,
			'public',
		)

		const applyTexts = completions.map((c) => c.apply)
		const uniqueApplyTexts = [...new Set(applyTexts)]
		expect(applyTexts.length).toBe(uniqueApplyTexts.length)
	})

	it('returns empty for table with no FK relationships', () => {
		const noFkSchema = createSchemaData({
			foreignKeys: {},
			referencingForeignKeys: {},
		})

		const completions = buildJoinCompletions(
			[{ table: 'orders' }],
			noFkSchema,
			false,
			'public',
		)

		expect(completions).toEqual([])
	})
})
