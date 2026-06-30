import { resolvePrintableEditAction } from '@dotaz/frontend-shared/lib/grid-editing-shortcuts'
import { DatabaseDataType, SQL_DEFAULT } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { describe, expect, test } from 'bun:test'

function col(dataType: DatabaseDataType, nullable = false): GridColumnDef {
	return {
		name: 'value',
		dataType,
		nullable,
		isPrimaryKey: false,
	}
}

describe('resolvePrintableEditAction', () => {
	test('starts text editing with the typed character, including quick-value letters', () => {
		expect(resolvePrintableEditAction('a', col(DatabaseDataType.Text))).toEqual({ type: 'start', initialValue: 'a' })
		expect(resolvePrintableEditAction('n', col(DatabaseDataType.Text, true))).toEqual({ type: 'start', initialValue: 'n' })
		expect(resolvePrintableEditAction('d', col(DatabaseDataType.Text))).toEqual({ type: 'start', initialValue: 'd' })
	})

	test('starts JSON editing with the typed character', () => {
		expect(resolvePrintableEditAction('{', col(DatabaseDataType.Json))).toEqual({ type: 'start', initialValue: '{' })
		expect(resolvePrintableEditAction('n', col(DatabaseDataType.Json, true))).toEqual({ type: 'start', initialValue: 'n' })
	})

	test('handles numeric NULL and DEFAULT shortcuts before opening the editor', () => {
		expect(resolvePrintableEditAction('n', col(DatabaseDataType.Integer, true))).toEqual({ type: 'save', value: null })
		expect(resolvePrintableEditAction('d', col(DatabaseDataType.Integer))).toEqual({ type: 'save', value: SQL_DEFAULT })
		expect(resolvePrintableEditAction('7', col(DatabaseDataType.Integer))).toEqual({ type: 'start', initialValue: '7' })
	})

	test('handles boolean true and false shortcuts before opening the editor', () => {
		expect(resolvePrintableEditAction('t', col(DatabaseDataType.Boolean))).toEqual({ type: 'save', value: true })
		expect(resolvePrintableEditAction('f', col(DatabaseDataType.Boolean))).toEqual({ type: 'save', value: false })
		expect(resolvePrintableEditAction('n', col(DatabaseDataType.Boolean, true))).toEqual({ type: 'save', value: null })
		expect(resolvePrintableEditAction('d', col(DatabaseDataType.Boolean))).toEqual({ type: 'save', value: SQL_DEFAULT })
		expect(resolvePrintableEditAction('x', col(DatabaseDataType.Boolean))).toEqual({ type: 'ignore' })
	})

	test('keeps date editing to explicit editor activation except quick values', () => {
		expect(resolvePrintableEditAction('n', col(DatabaseDataType.Date, true))).toEqual({ type: 'save', value: null })
		expect(resolvePrintableEditAction('d', col(DatabaseDataType.Timestamp))).toEqual({ type: 'save', value: SQL_DEFAULT })
		expect(resolvePrintableEditAction('2', col(DatabaseDataType.Date))).toEqual({ type: 'ignore' })
	})
})
