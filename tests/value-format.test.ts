/**
 * Unit tests for value-format helpers + valuesEqual. These cover the pure
 * pieces that the JSON/array column display & edit flows depend on:
 *
 *   - formatJsonValue       — keeps JSON-string scalars distinct from arrays
 *   - formatColumnValue     — column-type-aware display formatter
 *   - formatColumnValueForEditor — editor pre-fill (round-trip safe)
 *   - parseJsonColumnInput  — user input → JS value, with error reporting
 *   - valuesEqual           — change-detection equality (deep, JSON-based)
 */
import { formatColumnValue, formatColumnValueForEditor, formatJsonValue, parseJsonColumnInput } from '@dotaz/frontend-shared/lib/value-format'
import { valuesEqual } from '@dotaz/frontend-shared/stores/gridEditing'
import { SQL_DEFAULT } from '@dotaz/shared/types/database'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import { describe, expect, test } from 'bun:test'

describe('formatJsonValue — JSON-string scalar stays distinct from array', () => {
	test('JS array renders without surrounding quotes', () => {
		expect(formatJsonValue(['a', 'b'])).toBe('["a","b"]')
	})

	test('JS string scalar renders with surrounding quotes (the bug-distinction)', () => {
		// Stored in DB as `"[\"a\",\"b\"]"` → JS string `'["a","b"]'`
		// Without this distinction, it looks identical to a real array in the cell.
		expect(formatJsonValue('["a","b"]')).toBe('"[\\"a\\",\\"b\\"]"')
	})

	test('null renders as empty (caller decides null sentinel)', () => {
		expect(formatJsonValue(null)).toBe('')
		expect(formatJsonValue(undefined)).toBe('')
	})

	test('SQL DEFAULT renders as empty', () => {
		expect(formatJsonValue(SQL_DEFAULT)).toBe('')
	})

	test('pretty option produces multi-line output', () => {
		expect(formatJsonValue({ a: 1 }, true)).toBe('{\n  "a": 1\n}')
	})

	test('numeric and boolean JSON scalars round-trip', () => {
		expect(formatJsonValue(42)).toBe('42')
		expect(formatJsonValue(true)).toBe('true')
	})
})

describe('formatColumnValue — column-type-aware display', () => {
	test('JSON column: array', () => {
		expect(formatColumnValue(['x'], DatabaseDataType.Json)).toBe('["x"]')
	})

	test('JSON column: string scalar shows quotes', () => {
		expect(formatColumnValue('["x"]', DatabaseDataType.Json)).toBe('"[\\"x\\"]"')
	})

	test('Array column shares JSON-style rendering', () => {
		expect(formatColumnValue(['a', 'b'], DatabaseDataType.Array)).toBe('["a","b"]')
	})

	test('NULL → "NULL" by default, "" when nullText overridden (editor mode)', () => {
		expect(formatColumnValue(null, DatabaseDataType.Json)).toBe('NULL')
		expect(formatColumnValue(null, DatabaseDataType.Json, { nullText: '' })).toBe('')
	})

	test('DEFAULT → "DEFAULT" by default', () => {
		expect(formatColumnValue(SQL_DEFAULT, DatabaseDataType.Json)).toBe('DEFAULT')
	})

	test('text column with JSON-looking value pretty-prints when requested', () => {
		const out = formatColumnValue('{"a":1}', DatabaseDataType.Text, { pretty: true })
		expect(out).toBe('{\n  "a": 1\n}')
	})

	test('text column with JSON-looking value collapses whitespace when not pretty', () => {
		const out = formatColumnValue('{"a":1}', DatabaseDataType.Text)
		expect(out).toBe('{ "a": 1 }')
	})

	test('plain text column: returns string', () => {
		expect(formatColumnValue('hello', DatabaseDataType.Text)).toBe('hello')
	})

	test('maxLength truncates with ellipsis', () => {
		const long = 'a'.repeat(50)
		expect(formatColumnValue(long, DatabaseDataType.Text, { maxLength: 10 })).toBe('aaaaaaaaaa...')
	})
})

describe('formatColumnValueForEditor — round-trip safe pre-fill', () => {
	test('JSON array → editor text → parse → equal value', () => {
		const original = ['a', 'b']
		const text = formatColumnValueForEditor(original, DatabaseDataType.Json)
		const parsed = parseJsonColumnInput(text, false)
		expect(parsed.ok && parsed.value).toEqual(original)
	})

	test('JSON-string scalar round-trips as a string (not silently re-parsed)', () => {
		const original = '["a","b"]' // a JS string, not an array
		const text = formatColumnValueForEditor(original, DatabaseDataType.Json)
		const parsed = parseJsonColumnInput(text, false)
		expect(parsed.ok && parsed.value).toBe(original)
	})

	test('NULL/DEFAULT pre-fill is empty', () => {
		expect(formatColumnValueForEditor(null, DatabaseDataType.Json)).toBe('')
		expect(formatColumnValueForEditor(SQL_DEFAULT, DatabaseDataType.Json)).toBe('')
	})

	test('PG array round-trips through the editor pre-fill', () => {
		const original = [1, 2, 3]
		const text = formatColumnValueForEditor(original, DatabaseDataType.Array)
		const parsed = parseJsonColumnInput(text, false)
		expect(parsed.ok && parsed.value).toEqual(original)
	})
})

describe('parseJsonColumnInput', () => {
	test('valid JSON object', () => {
		const r = parseJsonColumnInput('{"a":1}', false)
		expect(r).toEqual({ ok: true, value: { a: 1 } })
	})

	test('valid JSON array', () => {
		const r = parseJsonColumnInput('[1,2,3]', false)
		expect(r).toEqual({ ok: true, value: [1, 2, 3] })
	})

	test('JSON string scalar parses to a JS string (preserved)', () => {
		const r = parseJsonColumnInput('"hello"', false)
		expect(r).toEqual({ ok: true, value: 'hello' })
	})

	test('empty + nullable → NULL', () => {
		expect(parseJsonColumnInput('', true)).toEqual({ ok: true, value: null })
	})

	test('empty + non-nullable → error', () => {
		const r = parseJsonColumnInput('', false)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toBe('Value is required')
	})

	test('invalid JSON → error with message', () => {
		const r = parseJsonColumnInput('{a:1}', false)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/JSON|Unexpected|expected/i)
	})
})

describe('valuesEqual — change detection', () => {
	test('strict equality short-circuits', () => {
		const a = { x: 1 }
		expect(valuesEqual(a, a)).toBe(true)
	})

	test('two arrays with the same content are equal (different identities)', () => {
		expect(valuesEqual(['a', 'b'], ['a', 'b'])).toBe(true)
	})

	test('two objects with the same content are equal', () => {
		expect(valuesEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
	})

	test('different arrays unequal', () => {
		expect(valuesEqual(['a', 'b'], ['a', 'c'])).toBe(false)
	})

	test('array vs string with same JSON-stringification (this is the original bug)', () => {
		// User clicked-out without typing: oldValue = parsed array, newValue =
		// raw text from input. Once the editor JSON-parses on save, both are
		// arrays and valuesEqual treats them as no change.
		const fromDb = ['a', 'b']
		const fromEditor = JSON.parse('["a","b"]')
		expect(valuesEqual(fromDb, fromEditor)).toBe(true)
	})

	test('string scalar vs string scalar — direct equality', () => {
		expect(valuesEqual('hello', 'hello')).toBe(true)
	})

	test('null/undefined comparisons', () => {
		expect(valuesEqual(null, null)).toBe(true)
		expect(valuesEqual(null, undefined)).toBe(false)
		expect(valuesEqual(null, ['a'])).toBe(false)
	})

	test('primitive vs object: not equal', () => {
		expect(valuesEqual('["a"]', ['a'])).toBe(false)
	})
})
