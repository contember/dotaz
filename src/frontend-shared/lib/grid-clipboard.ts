import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { type CellSelection, getSelectedColIndices, getSelectedRowIndices } from './grid-selection'

// ── Basic TSV ────────────────────────────────────────────

/** Format a cell value for TSV clipboard export. NULL -> empty string. */
export function formatCellForClipboard(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
		.replace(/\t/g, ' ')
		.replace(/\n/g, ' ')
		.replace(/\r/g, '')
}

/**
 * Build TSV string for clipboard from current selection.
 * Returns the TSV text and the count of copied rows (0 = single cell).
 */
export function buildClipboardTsv(
	rows: Record<string, unknown>[],
	visibleColumns: GridColumnDef[],
	selection: CellSelection,
): { text: string; rowCount: number } | null {
	if (selection.ranges.length === 0) return null

	const selectedRows = getSelectedRowIndices(selection)
	const selectedCols = getSelectedColIndices(selection)

	// Single cell -> copy just the cell value
	if (selectedRows.length === 1 && selectedCols.length === 1) {
		const row = rows[selectedRows[0]]
		if (!row) return null
		const colName = visibleColumns[selectedCols[0]]?.name
		if (!colName) return null
		return { text: formatCellForClipboard(row[colName]), rowCount: 0 }
	}

	const colNames = selectedCols
		.map((i) => visibleColumns[i]?.name)
		.filter(Boolean) as string[]
	const header = colNames.join('\t')
	const lines = selectedRows
		.filter((i) => rows[i] != null)
		.map((i) => {
			const row = rows[i]
			return colNames.map((col) => formatCellForClipboard(row[col])).join('\t')
		})

	return { text: [header, ...lines].join('\n'), rowCount: selectedRows.length }
}

// ── Advanced copy ────────────────────────────────────────

export type AdvancedCopyDelimiter = 'tab' | 'comma' | 'semicolon' | 'pipe' | 'custom'
export type AdvancedCopyValueFormat = 'displayed' | 'raw' | 'quoted'

export interface AdvancedCopyOptions {
	delimiter: AdvancedCopyDelimiter
	customDelimiter: string
	includeHeaders: boolean
	includeRowNumbers: boolean
	valueFormat: AdvancedCopyValueFormat
	nullRepresentation: string
}

const DELIMITER_MAP: Record<Exclude<AdvancedCopyDelimiter, 'custom'>, string> = {
	tab: '\t',
	comma: ',',
	semicolon: ';',
	pipe: '|',
}

function getDelimiterChar(options: AdvancedCopyOptions): string {
	return options.delimiter === 'custom'
		? options.customDelimiter || '\t'
		: DELIMITER_MAP[options.delimiter]
}

function formatAdvancedCellValue(value: unknown, options: AdvancedCopyOptions): string {
	if (value === null || value === undefined) return options.nullRepresentation

	const str = typeof value === 'object' ? JSON.stringify(value) : String(value)

	if (options.valueFormat === 'quoted') {
		return `'${str.replace(/'/g, "''")}'`
	}

	return str
}

/**
 * Build formatted clipboard text using advanced copy options.
 * Always copies all selected rows with visible columns (never single-cell mode).
 */
export function buildAdvancedCopyText(
	rows: Record<string, unknown>[],
	visibleColumns: GridColumnDef[],
	selection: CellSelection,
	options: AdvancedCopyOptions,
): string | null {
	if (selection.ranges.length === 0) return null

	const delim = getDelimiterChar(options)
	const selectedRows = getSelectedRowIndices(selection)
	const selectedCols = getSelectedColIndices(selection)
	const colNames = selectedCols
		.map((i) => visibleColumns[i]?.name)
		.filter(Boolean) as string[]
	const lines: string[] = []

	if (options.includeHeaders) {
		const headerParts = options.includeRowNumbers ? ['#', ...colNames] : colNames
		lines.push(headerParts.join(delim))
	}

	for (let i = 0; i < selectedRows.length; i++) {
		const rowIdx = selectedRows[i]
		const row = rows[rowIdx]
		if (!row) continue
		const values = colNames.map((col) => formatAdvancedCellValue(row[col], options))
		if (options.includeRowNumbers) {
			values.unshift(String(i + 1))
		}
		lines.push(values.join(delim))
	}

	return lines.join('\n')
}
