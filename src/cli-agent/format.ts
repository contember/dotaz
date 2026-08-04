// Output rendering. Pure — main.ts owns the writing, so every rule here is testable.

import { DatabaseDataType } from '@dotaz/shared/types/database'
import { usageError } from './errors'

export const OUTPUT_FORMATS = ['table', 'json', 'jsonl', 'csv', 'md'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const DEFAULT_MAX_BYTES = 65536

/** Wide cells are elided in the human formats only — csv/json/jsonl always carry the full value. */
export const MAX_CELL_WIDTH = 200

export function parseFormat(value: string): OutputFormat {
	for (const format of OUTPUT_FORMATS) {
		if (format === value) return format
	}
	throw usageError(`Unknown --format "${value}" (expected ${OUTPUT_FORMATS.join(', ')})`)
}

export interface RenderColumn {
	name: string
	dataType?: DatabaseDataType
}

export interface Section {
	title?: string
	columns: RenderColumn[]
	rows: Record<string, unknown>[]
	/** `kv` renders `key: value` lines instead of a grid — used for single-record output. */
	kind?: 'grid' | 'kv'
	/** Printed instead of the grid when there are no rows. */
	empty?: string
}

export interface RenderResult {
	stdout: string
	/** Diagnostics — truncation notices for the machine formats, which must not carry a footer. */
	stderr: string
	truncated: boolean
	shown: number
	total: number
}

/** The exact wording is part of the CLI contract (docs/agent-cli.md § Output rules). */
export function truncationLine(shown: number, total: number): string {
	return `rows: ${shown}/${total} (truncated, use --limit)`
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Byte length of a value that is (or decodes to) binary data, or null when it is not binary. */
export function binaryByteLength(value: unknown, dataType?: DatabaseDataType): number | null {
	if (value instanceof Uint8Array) return value.byteLength
	if (value instanceof ArrayBuffer) return value.byteLength
	// Bun/Node Buffers cross JSON as { type: 'Buffer', data: number[] }
	if (isRecord(value) && value.type === 'Buffer' && Array.isArray(value.data)) return value.data.length
	if (dataType === DatabaseDataType.Binary) {
		// PostgreSQL bytea arrives as a `\x…` hex string over JSON
		if (typeof value === 'string' && value.startsWith('\\x')) return Math.floor((value.length - 2) / 2)
		if (Array.isArray(value) && value.every((v) => typeof v === 'number')) return value.length
	}
	return null
}

function escapeControlChars(text: string): string {
	return text.replace(/\r\n|\n|\r/g, '\\n').replace(/\t/g, '\\t')
}

function elide(text: string): string {
	if (text.length <= MAX_CELL_WIDTH) return text
	return `${text.slice(0, MAX_CELL_WIDTH - 1)}…`
}

/**
 * Human-readable rendering of one cell.
 * SQL NULL prints as bare `NULL`; the *string* "NULL" prints quoted, so the two never collide.
 */
export function formatCell(value: unknown, dataType?: DatabaseDataType): string {
	if (value === null || value === undefined) return 'NULL'

	const bytes = binaryByteLength(value, dataType)
	if (bytes !== null) return `<binary ${formatByteSize(bytes)}>`

	if (typeof value === 'string') {
		const text = escapeControlChars(value)
		return elide(text.toUpperCase() === 'NULL' ? `"${text}"` : text)
	}
	if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value)
	if (value instanceof Date) return value.toISOString()
	return elide(escapeControlChars(JSON.stringify(value) ?? String(value)))
}

/** CSV keeps raw values; NULL becomes an empty field, per the usual CSV convention. */
function csvCell(value: unknown, dataType?: DatabaseDataType): string {
	if (value === null || value === undefined) return ''
	const bytes = binaryByteLength(value, dataType)
	if (bytes !== null) return `<binary ${formatByteSize(bytes)}>`
	const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value)
	if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
	return text
}

function mdCell(value: unknown, dataType?: DatabaseDataType): string {
	return formatCell(value, dataType).replace(/\|/g, '\\|')
}

function padTo(text: string, width: number): string {
	return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function gridLines(section: Section): { head: string[]; rows: string[] } {
	const cells = section.rows.map((row) => section.columns.map((col) => formatCell(row[col.name], col.dataType)))
	const widths = section.columns.map((col, i) => {
		let width = col.name.length
		for (const rowCells of cells) width = Math.max(width, rowCells[i].length)
		return width
	})

	const head: string[] = []
	if (section.title) head.push(section.title)
	head.push(section.columns.map((col, i) => padTo(col.name, widths[i])).join('  ').trimEnd())
	head.push(widths.map((w) => '-'.repeat(w)).join('  '))

	if (section.rows.length === 0 && section.empty) return { head: section.title ? [section.title, section.empty] : [section.empty], rows: [] }

	return { head, rows: cells.map((rowCells) => rowCells.map((cell, i) => padTo(cell, widths[i])).join('  ').trimEnd()) }
}

function kvLines(section: Section): { head: string[]; rows: string[] } {
	const head: string[] = section.title ? [section.title] : []
	const rows: string[] = []
	const width = Math.max(0, ...section.columns.map((c) => c.name.length))
	for (const row of section.rows) {
		for (const col of section.columns) {
			rows.push(`${padTo(`${col.name}:`, width + 1)} ${formatCell(row[col.name], col.dataType)}`)
		}
	}
	if (rows.length === 0 && section.empty) head.push(section.empty)
	return { head, rows }
}

function mdLines(section: Section): { head: string[]; rows: string[] } {
	const head: string[] = []
	if (section.title) {
		head.push(`### ${section.title}`)
		head.push('')
	}
	head.push(`| ${section.columns.map((c) => c.name).join(' | ')} |`)
	head.push(`| ${section.columns.map(() => '---').join(' | ')} |`)
	return {
		head,
		rows: section.rows.map((row) => `| ${section.columns.map((col) => mdCell(row[col.name], col.dataType)).join(' | ')} |`),
	}
}

function csvLines(section: Section): { head: string[]; rows: string[] } {
	return {
		head: [section.columns.map((c) => csvCell(c.name)).join(',')],
		rows: section.rows.map((row) => section.columns.map((col) => csvCell(row[col.name], col.dataType)).join(',')),
	}
}

function jsonlLines(section: Section): { head: string[]; rows: string[] } {
	return { head: [], rows: section.rows.map((row) => JSON.stringify(row)) }
}

function linesFor(section: Section, format: OutputFormat): { head: string[]; rows: string[] } {
	switch (format) {
		case 'md':
			return mdLines(section)
		case 'csv':
			return csvLines(section)
		case 'jsonl':
			return jsonlLines(section)
		default:
			return section.kind === 'kv' ? kvLines(section) : gridLines(section)
	}
}

/**
 * Render sections under a hard byte budget. Rows are dropped from the end only, and the caller
 * is always told how many were dropped — output is never silently short.
 */
export function renderSections(sections: Section[], format: OutputFormat, maxBytes: number): RenderResult {
	const machineFormat = format === 'csv' || format === 'jsonl'
	// csv/jsonl are single-stream formats — a second table would corrupt them
	const emitted = (machineFormat ? sections.slice(0, 1) : sections).map((section) => linesFor(section, format))
	// Counted in emitted lines, not source rows: a kv section turns one record into several lines
	const total = emitted.reduce((sum, section) => sum + section.rows.length, 0)

	const out: string[] = []
	let budget = maxBytes
	let shown = 0
	let truncated = false

	for (const [index, { head, rows }] of emitted.entries()) {
		if (truncated) break
		if (index > 0 && !machineFormat) out.push('')
		// Headers are structural: they are charged to the budget but never dropped
		for (const line of head) {
			out.push(line)
			budget -= byteLength(line) + 1
		}
		for (const line of rows) {
			const cost = byteLength(line) + 1
			if (budget - cost < 0) {
				truncated = true
				break
			}
			budget -= cost
			out.push(line)
			shown++
		}
	}

	const skippedSections = machineFormat && sections.length > 1
	const notices: string[] = []
	if (skippedSections) notices.push(`${sections.length - 1} additional section(s) omitted — --format ${format} emits a single table`)

	let stdout = out.length > 0 ? `${out.join('\n')}\n` : ''
	if (truncated) {
		const line = truncationLine(shown, total)
		// The footer must be the last line of the human formats; machine formats keep stdout clean
		if (machineFormat) notices.push(line)
		else stdout += `${line}\n`
	}

	return { stdout, stderr: notices.length > 0 ? `${notices.join('\n')}\n` : '', truncated, shown, total }
}

/**
 * `--format json` emits one object, so truncation is expressed inside it rather than as a footer.
 * Rows are dropped from the end until the serialized document fits the budget.
 */
export function capJsonRows<T>(rows: T[], maxBytes: number, overheadBytes: number): { kept: T[]; truncated: boolean } {
	let used = overheadBytes
	const kept: T[] = []
	for (const row of rows) {
		const cost = byteLength(JSON.stringify(row) ?? 'null') + 1
		if (used + cost > maxBytes) return { kept, truncated: true }
		used += cost
		kept.push(row)
	}
	return { kept, truncated: false }
}
