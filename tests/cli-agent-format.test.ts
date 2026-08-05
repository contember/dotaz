import { DatabaseDataType } from '@dotaz/shared/types/database'
import { describe, expect, test } from 'bun:test'
import { CliError, EXIT } from '../src/cli-agent/errors'
import {
	binaryByteLength,
	capJsonRows,
	formatByteSize,
	formatCell,
	MAX_CELL_WIDTH,
	OUTPUT_FORMATS,
	parseFormat,
	renderSections,
	type Section,
	truncationLine,
} from '../src/cli-agent/format'
import { renderOutput } from '../src/cli-agent/output'

function rowsSection(count: number, width = 10): Section {
	return {
		columns: [{ name: 'id' }, { name: 'value' }],
		rows: Array.from({ length: count }, (_, i) => ({ id: i, value: 'x'.repeat(width) })),
	}
}

describe('parseFormat', () => {
	test('accepts every documented format', () => {
		for (const format of OUTPUT_FORMATS) {
			expect(parseFormat(format)).toBe(format)
		}
	})

	test('rejects anything else with a usage error', () => {
		try {
			parseFormat('xml')
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.usage)
		}
	})
})

describe('formatCell', () => {
	test('SQL NULL is distinguishable from the string "NULL"', () => {
		expect(formatCell(null)).toBe('NULL')
		expect(formatCell(undefined)).toBe('NULL')
		expect(formatCell('NULL')).toBe('"NULL"')
		expect(formatCell('null')).toBe('"null"')
		expect(formatCell('nullable')).toBe('nullable')
	})

	test('binary values print as a size, not as bytes', () => {
		expect(formatCell(new Uint8Array(1500))).toBe('<binary 1.5 KB>')
		expect(formatCell({ type: 'Buffer', data: [1, 2, 3] })).toBe('<binary 3 B>')
		expect(formatCell('\\x0102ff', DatabaseDataType.Binary)).toBe('<binary 3 B>')
	})

	test('control characters are escaped so a row stays one line', () => {
		expect(formatCell('a\nb\tc')).toBe('a\\nb\\tc')
	})

	test('scalars and objects', () => {
		expect(formatCell(42)).toBe('42')
		expect(formatCell(true)).toBe('true')
		expect(formatCell(new Date('2024-01-02T03:04:05.000Z'))).toBe('2024-01-02T03:04:05.000Z')
		expect(formatCell({ a: 1 })).toBe('{"a":1}')
	})

	test('very wide cells are elided in the human formats', () => {
		const rendered = formatCell('y'.repeat(MAX_CELL_WIDTH + 50))
		expect(rendered.length).toBe(MAX_CELL_WIDTH)
		expect(rendered.endsWith('…')).toBe(true)
	})
})

describe('binaryByteLength', () => {
	test('recognises the JSON shapes a Buffer can take', () => {
		expect(binaryByteLength(new Uint8Array(4))).toBe(4)
		expect(binaryByteLength(new ArrayBuffer(8))).toBe(8)
		expect(binaryByteLength({ type: 'Buffer', data: [1, 2] })).toBe(2)
		expect(binaryByteLength('plain text')).toBeNull()
	})

	test('formatByteSize scales', () => {
		expect(formatByteSize(512)).toBe('512 B')
		expect(formatByteSize(2048)).toBe('2.0 KB')
		expect(formatByteSize(3 * 1024 * 1024)).toBe('3.0 MB')
	})
})

describe('renderSections — table', () => {
	test('aligns columns and keeps a separator', () => {
		const result = renderSections([{ columns: [{ name: 'id' }, { name: 'name' }], rows: [{ id: 1, name: 'alpha' }] }], 'table', 65536)
		const lines = result.stdout.trimEnd().split('\n')
		expect(lines[0]).toBe('id  name')
		expect(lines[1]).toBe('--  -----')
		expect(lines[2]).toBe('1   alpha')
		expect(result.truncated).toBe(false)
	})

	test('empty result sets print the placeholder', () => {
		const result = renderSections([{ columns: [{ name: 'id' }], rows: [], empty: '(no rows)' }], 'table', 65536)
		expect(result.stdout).toBe('(no rows)\n')
	})

	test('kv sections print key: value lines', () => {
		const result = renderSections(
			[{ kind: 'kv', columns: [{ name: 'status' }, { name: 'pid' }], rows: [{ status: 'running', pid: 7 }] }],
			'table',
			65536,
		)
		expect(result.stdout).toBe('status: running\npid:    7\n')
	})
})

describe('renderSections — byte cap', () => {
	test('the last line is exactly the documented truncation line', () => {
		const result = renderSections([rowsSection(50)], 'table', 200)
		const lines = result.stdout.trimEnd().split('\n')
		expect(lines[lines.length - 1]).toBe(truncationLine(result.shown, 50))
		expect(result.truncated).toBe(true)
		expect(result.shown).toBeGreaterThan(0)
		expect(result.shown).toBeLessThan(50)
	})

	test('the cap is respected in bytes', () => {
		const result = renderSections([rowsSection(500)], 'table', 400)
		expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(400 + truncationLine(result.shown, 500).length + 1)
	})

	test('nothing is truncated when the output fits', () => {
		const result = renderSections([rowsSection(3)], 'table', 65536)
		expect(result.truncated).toBe(false)
		expect(result.shown).toBe(3)
		expect(result.stdout).not.toContain('truncated')
	})

	test('total counts rows across every section', () => {
		const result = renderSections([rowsSection(2), rowsSection(3)], 'table', 65536)
		expect(result.total).toBe(5)
		expect(result.shown).toBe(5)
	})
})

describe('renderSections — machine formats', () => {
	test('csv quotes what needs quoting', () => {
		const result = renderSections([{ columns: [{ name: 'a' }, { name: 'b' }], rows: [{ a: 'x,y', b: null }] }], 'csv', 65536)
		expect(result.stdout).toBe('a,b\n"x,y",\n')
	})

	test('jsonl emits one row per line and no header', () => {
		const result = renderSections([{ columns: [{ name: 'a' }], rows: [{ a: 1 }, { a: 2 }] }], 'jsonl', 65536)
		expect(result.stdout).toBe('{"a":1}\n{"a":2}\n')
	})

	test('machine formats keep the truncation notice off stdout', () => {
		const result = renderSections([rowsSection(50)], 'jsonl', 120)
		expect(result.truncated).toBe(true)
		expect(result.stdout).not.toContain('truncated')
		expect(result.stderr.trimEnd()).toBe(truncationLine(result.shown, 50))
	})

	test('csv drops extra sections and says so', () => {
		const result = renderSections([rowsSection(1), rowsSection(1)], 'csv', 65536)
		expect(result.stderr).toContain('additional section')
	})

	test('md escapes pipes', () => {
		const result = renderSections([{ columns: [{ name: 'a' }], rows: [{ a: 'x|y' }] }], 'md', 65536)
		expect(result.stdout).toContain('| x\\|y |')
	})
})

describe('capJsonRows', () => {
	test('keeps rows while they fit', () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({ i, pad: 'z'.repeat(20) }))
		const { kept, truncated } = capJsonRows(rows, 200, 20)
		expect(truncated).toBe(true)
		expect(kept.length).toBeGreaterThan(0)
		expect(kept.length).toBeLessThan(10)
	})

	test('keeps everything when it fits', () => {
		const rows = [{ a: 1 }, { a: 2 }]
		expect(capJsonRows(rows, 65536, 0)).toEqual({ kept: rows, truncated: false })
	})
})

describe('renderOutput', () => {
	const opts = { format: 'json' as const, maxBytes: 65536, quiet: false }

	test('--json emits a single object', () => {
		const rendered = renderOutput({ sections: [], json: { ok: true, rows: [{ a: 1 }] } }, opts)
		expect(JSON.parse(rendered.stdout)).toEqual({ ok: true, rows: [{ a: 1 }] })
	})

	test('--json stays valid JSON when it has to drop rows', () => {
		const rows = Array.from({ length: 200 }, (_, i) => ({ i, pad: 'q'.repeat(50) }))
		const rendered = renderOutput({ sections: [], json: { rows } }, { ...opts, maxBytes: 500 })
		const parsed = JSON.parse(rendered.stdout)
		expect(parsed.truncated).toBe(true)
		expect(parsed.total).toBe(200)
		expect(parsed.shown).toBe(parsed.rows.length)
		expect(parsed.rows.length).toBeLessThan(200)
		expect(rendered.stderr).toContain('truncated')
	})

	test('--quiet suppresses notes and diagnostics', () => {
		const rendered = renderOutput({ sections: [rowsSection(1)], json: {}, notes: ['a note'] }, { format: 'table', maxBytes: 65536, quiet: true })
		expect(rendered.stderr).toBe('')
	})

	// For csv/jsonl the stderr line is the ONLY signal that rows are missing — stdout carries
	// no footer. Dropping it under --quiet let an agent read a truncated result as a whole
	// table, and `--format jsonl --quiet` is exactly how an agent pipes rows.
	test.each(['jsonl', 'csv'] as const)('--quiet still reports truncation for --format %s', (format) => {
		const rendered = renderOutput({ sections: [rowsSection(50)], json: {}, notes: ['a note'] }, { format, maxBytes: 40, quiet: true })

		expect(rendered.stderr).toContain('truncated')
		expect(rendered.stderr).not.toContain('a note')
	})

	test.each(['table', 'md'] as const)('--format %s carries truncation on stdout, so --quiet cannot hide it', (format) => {
		const rendered = renderOutput({ sections: [rowsSection(50)], json: {}, notes: ['a note'] }, { format, maxBytes: 40, quiet: true })

		expect(rendered.stdout).toContain('truncated')
		expect(rendered.stderr).toBe('')
	})

	test('--quiet still reports truncation for --json', () => {
		const rows = Array.from({ length: 200 }, (_, i) => ({ i, pad: 'q'.repeat(50) }))
		const rendered = renderOutput({ sections: [], json: { rows } }, { ...opts, maxBytes: 500, quiet: true })

		expect(JSON.parse(rendered.stdout).truncated).toBe(true)
		expect(rendered.stderr).toContain('truncated')
	})

	test('notes go to stderr, never stdout', () => {
		const rendered = renderOutput({ sections: [rowsSection(1)], json: {}, notes: ['a note'] }, { format: 'table', maxBytes: 65536, quiet: false })
		expect(rendered.stderr).toContain('a note')
		expect(rendered.stdout).not.toContain('a note')
	})
})
