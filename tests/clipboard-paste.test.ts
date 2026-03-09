import { describe, expect, test } from 'bun:test'
import { cellValueToDbValue, detectDelimiter, parseClipboardText } from '@dotaz/shared/clipboard-paste'

describe('detectDelimiter', () => {
	test('detects tab delimiter', () => {
		expect(detectDelimiter('a\tb\tc')).toBe('\t')
	})

	test('detects comma delimiter', () => {
		expect(detectDelimiter('a,b,c')).toBe(',')
	})

	test('detects semicolon delimiter', () => {
		expect(detectDelimiter('a;b;c')).toBe(';')
	})

	test('prefers tab over comma', () => {
		expect(detectDelimiter('a,b\tc')).toBe('\t')
	})

	test('prefers comma over semicolon', () => {
		expect(detectDelimiter('a;b,c')).toBe(',')
	})

	test('ignores delimiters inside quotes', () => {
		expect(detectDelimiter('"a,b"\tc')).toBe('\t')
	})

	test('defaults to tab when no delimiters found', () => {
		expect(detectDelimiter('hello')).toBe('\t')
	})
})

describe('parseClipboardText', () => {
	test('parses tab-delimited rows', () => {
		const result = parseClipboardText('a\tb\nc\td')
		expect(result.delimiter).toBe('\t')
		expect(result.rows).toEqual([['a', 'b'], ['c', 'd']])
	})

	test('parses comma-delimited rows', () => {
		const result = parseClipboardText('a,b\nc,d')
		expect(result.delimiter).toBe(',')
		expect(result.rows).toEqual([['a', 'b'], ['c', 'd']])
	})

	test('parses semicolon-delimited rows', () => {
		const result = parseClipboardText('a;b\nc;d')
		expect(result.delimiter).toBe(';')
		expect(result.rows).toEqual([['a', 'b'], ['c', 'd']])
	})

	test('handles quoted values with commas', () => {
		const result = parseClipboardText('"a,b",c')
		expect(result.rows).toEqual([['a,b', 'c']])
	})

	test('handles escaped quotes inside quoted values', () => {
		const result = parseClipboardText('"say ""hello""",b')
		expect(result.rows).toEqual([['say "hello"', 'b']])
	})

	test('handles newlines within quoted values', () => {
		const result = parseClipboardText('"line1\nline2",b\nc,d')
		expect(result.rows).toEqual([['line1\nline2', 'b'], ['c', 'd']])
	})

	test('handles CRLF line endings', () => {
		const result = parseClipboardText('a\tb\r\nc\td')
		expect(result.rows).toEqual([['a', 'b'], ['c', 'd']])
	})

	test('trims whitespace from unquoted values', () => {
		const result = parseClipboardText('  a  \t  b  ')
		expect(result.rows).toEqual([['a', 'b']])
	})

	test('preserves whitespace inside quoted values', () => {
		const result = parseClipboardText('"  a  ",b')
		expect(result.rows).toEqual([['  a  ', 'b']])
	})

	test('handles trailing newline', () => {
		const result = parseClipboardText('a\tb\nc\td\n')
		expect(result.rows).toEqual([['a', 'b'], ['c', 'd']])
	})

	test('returns empty rows for empty text', () => {
		const result = parseClipboardText('')
		expect(result.rows).toEqual([])
	})

	test('returns empty rows for whitespace-only text', () => {
		const result = parseClipboardText('   \n  ')
		expect(result.rows).toEqual([])
	})

	test('handles single cell', () => {
		const result = parseClipboardText('hello')
		expect(result.rows).toEqual([['hello']])
	})

	test('handles single column multiple rows', () => {
		const result = parseClipboardText('a\nb\nc')
		expect(result.rows).toEqual([['a'], ['b'], ['c']])
	})

	test('handles mixed-length rows', () => {
		const result = parseClipboardText('a\tb\tc\nd\te')
		expect(result.rows).toEqual([['a', 'b', 'c'], ['d', 'e']])
	})
})

describe('cellValueToDbValue', () => {
	test('empty string returns null', () => {
		expect(cellValueToDbValue('', true)).toBe(null)
		expect(cellValueToDbValue('', false)).toBe(null)
	})

	test('NULL text returns null when treatNullText is true', () => {
		expect(cellValueToDbValue('NULL', true)).toBe(null)
		expect(cellValueToDbValue('null', true)).toBe(null)
		expect(cellValueToDbValue('Null', true)).toBe(null)
	})

	test('NULL text returns string when treatNullText is false', () => {
		expect(cellValueToDbValue('NULL', false)).toBe('NULL')
	})

	test('non-empty string returns string', () => {
		expect(cellValueToDbValue('hello', true)).toBe('hello')
		expect(cellValueToDbValue('123', true)).toBe('123')
	})
})
