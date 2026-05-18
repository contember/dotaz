import { describe, expect, test } from 'bun:test'
import {
	buildRowKey,
	diffByPk,
	getPkColumns,
	intensityForAge,
	LIVE_HALFLIFE_TICKS,
	mergeAged,
	NEW_ROW_SENTINEL,
} from '../src/frontend-shared/stores/gridLiveMode'
import { DatabaseDataType } from '../src/shared/types/database'
import type { GridColumnDef } from '../src/shared/types/grid'

const cols: GridColumnDef[] = [
	{ name: 'id', dataType: DatabaseDataType.Integer, nullable: false, isPrimaryKey: true },
	{ name: 'name', dataType: DatabaseDataType.Text, nullable: true, isPrimaryKey: false },
	{ name: 'qty', dataType: DatabaseDataType.Integer, nullable: true, isPrimaryKey: false },
]

describe('getPkColumns', () => {
	test('extracts PK column names', () => {
		expect(getPkColumns(cols)).toEqual(['id'])
	})

	test('returns [] when no PK', () => {
		expect(getPkColumns(cols.map((c) => ({ ...c, isPrimaryKey: false })))).toEqual([])
	})
})

describe('buildRowKey', () => {
	test('builds key from single PK column', () => {
		expect(buildRowKey({ id: 42, name: 'x' }, ['id'])).toBe('42')
	})

	test('joins composite PK into a deterministic key', () => {
		const k1 = buildRowKey({ a: 1, b: 'foo' }, ['a', 'b'])
		const k2 = buildRowKey({ a: 1, b: 'foo' }, ['a', 'b'])
		expect(k1).not.toBeNull()
		expect(k1).toBe(k2)
		// Different values must produce different keys.
		expect(buildRowKey({ a: 1, b: 'foo' }, ['a', 'b']))
			.not.toBe(buildRowKey({ a: 1, b: 'bar' }, ['a', 'b']))
	})

	test('composite-key separator is unambiguous (no collision via concatenation)', () => {
		// Without a reserved separator, ('1', '2foo') and ('12', 'foo') could collide.
		const k1 = buildRowKey({ a: '1', b: '2foo' }, ['a', 'b'])
		const k2 = buildRowKey({ a: '12', b: 'foo' }, ['a', 'b'])
		expect(k1).not.toBe(k2)
	})

	test('returns null when PK value is null', () => {
		expect(buildRowKey({ id: null, name: 'x' }, ['id'])).toBeNull()
	})

	test('returns null when PK column list is empty', () => {
		expect(buildRowKey({ id: 1 }, [])).toBeNull()
	})
})

describe('intensityForAge', () => {
	test('age 0 → intensity 1', () => {
		expect(intensityForAge(0)).toBe(1)
	})

	test(`age = halflife (${LIVE_HALFLIFE_TICKS}) → intensity ≈ 0.5`, () => {
		expect(intensityForAge(LIVE_HALFLIFE_TICKS)).toBeCloseTo(0.5, 6)
	})

	test('age = 2 × halflife → intensity ≈ 0.25', () => {
		expect(intensityForAge(LIVE_HALFLIFE_TICKS * 2)).toBeCloseTo(0.25, 6)
	})

	test('age past cutoff → 0', () => {
		expect(intensityForAge(1000)).toBe(0)
	})

	test('negative age → 0', () => {
		expect(intensityForAge(-1)).toBe(0)
	})
})

describe('diffByPk', () => {
	test('detects new row as NEW_ROW_SENTINEL with age 0', () => {
		const oldRows: Record<string, unknown>[] = []
		const newRows = [{ id: 1, name: 'foo', qty: 10 }]
		const diff = diffByPk(oldRows, newRows, ['id'], cols)
		expect(diff).not.toBeNull()
		expect(diff!.get('1')?.get(NEW_ROW_SENTINEL)).toBe(0)
	})

	test('detects changed cell, ignores unchanged ones', () => {
		const oldRows = [{ id: 1, name: 'foo', qty: 10 }]
		const newRows = [{ id: 1, name: 'foo', qty: 99 }]
		const diff = diffByPk(oldRows, newRows, ['id'], cols)
		expect(diff!.get('1')?.has('qty')).toBe(true)
		expect(diff!.get('1')?.has('name')).toBe(false)
	})

	test('ignores PK column even if it appears to change', () => {
		const oldRows = [{ id: 1, name: 'foo', qty: 10 }]
		const newRows = [{ id: 1, name: 'foo', qty: 10 }]
		const diff = diffByPk(oldRows, newRows, ['id'], cols)
		expect(diff!.has('1')).toBe(false)
	})

	test('returns null when no PK columns', () => {
		expect(diffByPk([], [{ name: 'x' }], [], cols)).toBeNull()
	})

	test('treats objects via JSON equality', () => {
		const oldRows = [{ id: 1, name: 'foo', qty: { a: 1 } as unknown }]
		const newRows = [{ id: 1, name: 'foo', qty: { a: 1 } as unknown }]
		const diff = diffByPk(oldRows, newRows, ['id'], cols)
		expect(diff!.has('1')).toBe(false)
	})

	test('removed row does not appear (only new/changed are tracked)', () => {
		const oldRows = [{ id: 1, name: 'foo', qty: 10 }]
		const newRows: Record<string, unknown>[] = []
		const diff = diffByPk(oldRows, newRows, ['id'], cols)
		expect(diff!.size).toBe(0)
	})
})

describe('mergeAged', () => {
	test('ages existing entries by 1 tick', () => {
		const prev = new Map([['1', new Map([['qty', 3]])]])
		const fresh = new Map<string, Map<string, number>>()
		const merged = mergeAged(prev, fresh)
		expect(merged.get('1')!.get('qty')).toBe(4)
	})

	test('drops entries past cutoff', () => {
		const prev = new Map([['1', new Map([['qty', 50]])]])
		const fresh = new Map<string, Map<string, number>>()
		const merged = mergeAged(prev, fresh)
		expect(merged.has('1')).toBe(false)
	})

	test('fresh changes override aged entries', () => {
		const prev = new Map([['1', new Map([['qty', 5]])]])
		const fresh = new Map([['1', new Map([['qty', 0]])]])
		const merged = mergeAged(prev, fresh)
		expect(merged.get('1')!.get('qty')).toBe(0)
	})

	test('merges fresh changes with aged ones for the same row', () => {
		const prev = new Map([['1', new Map([['qty', 5]])]])
		const fresh = new Map([['1', new Map([['name', 0]])]])
		const merged = mergeAged(prev, fresh)
		expect(merged.get('1')!.get('qty')).toBe(6)
		expect(merged.get('1')!.get('name')).toBe(0)
	})

	test('returns a new Map (reference inequality for reactive consumers)', () => {
		const prev = new Map([['1', new Map([['qty', 1]])]])
		const fresh = new Map<string, Map<string, number>>()
		const merged = mergeAged(prev, fresh)
		expect(merged).not.toBe(prev)
	})
})
