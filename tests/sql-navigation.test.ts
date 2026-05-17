import { describe, expect, test } from 'bun:test'
import type { SchemaData } from '../src/shared/types/database'
import { resolveIdentifierToTable } from '../src/frontend-shared/lib/sql-navigation'

function makeSchemaData(): SchemaData {
	return {
		schemas: [{ name: 'public' }, { name: 'auth' }],
		tables: {
			public: [
				{ schema: 'public', name: 'users', type: 'table' },
				{ schema: 'public', name: 'orders', type: 'table' },
			],
			auth: [
				{ schema: 'auth', name: 'users', type: 'table' },
				{ schema: 'auth', name: 'tokens', type: 'table' },
			],
		},
		columns: {},
		indexes: {},
		foreignKeys: {},
		referencingForeignKeys: {},
	}
}

describe('resolveIdentifierToTable', () => {
	test('resolves schema-qualified identifier', () => {
		const r = resolveIdentifierToTable(
			{ name: 'users', schema: 'auth', from: 0, to: 5, qualifiedFrom: 0 },
			makeSchemaData(),
		)
		expect(r).toEqual({ schema: 'auth', table: 'users', type: 'table' })
	})

	test('resolves unqualified unique table', () => {
		const r = resolveIdentifierToTable(
			{ name: 'orders', from: 0, to: 6, qualifiedFrom: 0 },
			makeSchemaData(),
		)
		expect(r?.schema).toBe('public')
	})

	test('prefers public on ambiguous match', () => {
		const r = resolveIdentifierToTable(
			{ name: 'users', from: 0, to: 5, qualifiedFrom: 0 },
			makeSchemaData(),
		)
		expect(r?.schema).toBe('public')
	})

	test('case-insensitive match', () => {
		const r = resolveIdentifierToTable(
			{ name: 'USERS', from: 0, to: 5, qualifiedFrom: 0 },
			makeSchemaData(),
		)
		expect(r?.table).toBe('users')
	})

	test('returns null when no schema data', () => {
		expect(resolveIdentifierToTable({ name: 'users', from: 0, to: 5, qualifiedFrom: 0 }, undefined)).toBeNull()
	})

	test('returns null when no match', () => {
		const r = resolveIdentifierToTable(
			{ name: 'nonexistent', from: 0, to: 11, qualifiedFrom: 0 },
			makeSchemaData(),
		)
		expect(r).toBeNull()
	})
})
