import type { ColumnMapping, CsvDelimiter, ImportFormat, ImportPreviewResult, ImportResult } from '../../shared/types/import'
import type { DatabaseDriver } from '../db/driver'
import { CsvParseError, parseCsvStream } from './csv-stream-parser'
import type { CsvStreamOptions } from './csv-stream-parser'

const DEFAULT_BATCH_SIZE = 100

export interface ImportStreamParams {
	schema: string
	table: string
	format: ImportFormat
	delimiter?: CsvDelimiter
	hasHeader?: boolean
	mappings: ColumnMapping[]
	batchSize?: number
}

/**
 * Stream-import data into a table using the streaming CSV parser + driver.importBatch().
 * Full rollback on any error (parse, DB, cancellation). All-or-nothing.
 */
export async function importFromStream(
	driver: DatabaseDriver,
	stream: ReadableStream<Uint8Array>,
	params: ImportStreamParams,
	signal?: AbortSignal,
	onProgress?: (rowsInserted: number) => void,
): Promise<ImportResult> {
	const activeMappings = params.mappings.filter((m) => m.tableColumn !== null)
	if (activeMappings.length === 0) {
		throw new Error('No columns mapped for import')
	}

	if (params.format === 'json') {
		return importJsonFromStream(driver, stream, params, activeMappings, signal, onProgress)
	}

	const qualifiedTable = driver.qualifyTable(params.schema, params.table)
	const columns = activeMappings.map((m) => m.tableColumn!)
	const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE

	const csvOptions: CsvStreamOptions = {
		delimiter: params.delimiter ?? ',',
		hasHeader: params.hasHeader ?? true,
		batchSize,
	}

	await driver.beginTransaction()
	try {
		let totalInserted = 0

		for await (const { rows } of parseCsvStream(stream, csvOptions)) {
			if (signal?.aborted) throw new Error('Import cancelled')
			const mappedRows = rows.map((row) => mapRow(row, activeMappings))
			await driver.importBatch(qualifiedTable, columns, mappedRows)
			totalInserted += rows.length
			onProgress?.(totalInserted)
		}

		await driver.commit()
		return { rowCount: totalInserted }
	} catch (err) {
		try {
			await driver.rollback()
		} catch (rbErr) {
			console.debug('Rollback after import error failed:', rbErr instanceof Error ? rbErr.message : rbErr)
		}
		throw err
	}
}

/**
 * Preview import from a stream — reads only the first rows (maxRows), does not consume entire stream.
 */
export async function importPreviewFromStream(
	stream: ReadableStream<Uint8Array>,
	params: {
		format: ImportFormat
		delimiter?: CsvDelimiter
		hasHeader?: boolean
		limit?: number
	},
): Promise<ImportPreviewResult> {
	const maxRows = params.limit ?? 20

	if (params.format === 'json') {
		return importPreviewJson(stream)
	}

	const csvOptions: CsvStreamOptions = {
		delimiter: params.delimiter ?? ',',
		hasHeader: params.hasHeader ?? true,
		batchSize: maxRows,
		maxRows,
	}

	const allRows: Record<string, unknown>[] = []
	let columns: string[] = []

	for await (const batch of parseCsvStream(stream, csvOptions)) {
		columns = batch.columns
		allRows.push(...batch.rows)
	}

	return {
		fileColumns: columns,
		rows: allRows.slice(0, maxRows),
		totalRows: undefined,
	}
}

// ── JSON import (in-memory) ────────────────────────────────

async function importJsonFromStream(
	driver: DatabaseDriver,
	stream: ReadableStream<Uint8Array>,
	params: ImportStreamParams,
	activeMappings: ColumnMapping[],
	signal?: AbortSignal,
	onProgress?: (rowsInserted: number) => void,
): Promise<ImportResult> {
	const text = await streamToString(stream)
	const rows = parseJson(text)

	const qualifiedTable = driver.qualifyTable(params.schema, params.table)
	const columns = activeMappings.map((m) => m.tableColumn!)
	const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE

	await driver.beginTransaction()
	try {
		let totalInserted = 0

		for (let offset = 0; offset < rows.length; offset += batchSize) {
			if (signal?.aborted) throw new Error('Import cancelled')
			const batch = rows.slice(offset, offset + batchSize)
			const mappedRows = batch.map((row) => mapRow(row, activeMappings))
			await driver.importBatch(qualifiedTable, columns, mappedRows)
			totalInserted += batch.length
			onProgress?.(totalInserted)
		}

		await driver.commit()
		return { rowCount: totalInserted }
	} catch (err) {
		try {
			await driver.rollback()
		} catch (rbErr) {
			console.debug('Rollback after import error failed:', rbErr instanceof Error ? rbErr.message : rbErr)
		}
		throw err
	}
}

async function importPreviewJson(
	stream: ReadableStream<Uint8Array>,
): Promise<ImportPreviewResult> {
	const text = await streamToString(stream)
	const rows = parseJson(text)
	const fileColumns = collectColumns(rows)
	return {
		fileColumns,
		rows: rows.slice(0, 20),
		totalRows: rows.length,
	}
}

// ── JSON parsing ───────────────────────────────────────────

export function parseJson(content: string): Record<string, unknown>[] {
	const parsed = JSON.parse(content)

	if (!Array.isArray(parsed)) {
		throw new Error('JSON import expects an array of objects')
	}

	const rows: Record<string, unknown>[] = []
	for (const item of parsed) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			throw new Error('Each JSON array element must be an object')
		}
		rows.push(item as Record<string, unknown>)
	}

	return rows
}

// ── Helpers ────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>, activeMappings: ColumnMapping[]): Record<string, unknown> {
	const mapped: Record<string, unknown> = {}
	for (const mapping of activeMappings) {
		mapped[mapping.tableColumn!] = row[mapping.fileColumn] ?? null
	}
	return mapped
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>()
	const columns: string[] = []
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key)
				columns.push(key)
			}
		}
	}
	return columns
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader()
	const decoder = new TextDecoder('utf-8')
	let result = ''
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		result += decoder.decode(value, { stream: true })
	}
	result += decoder.decode(new Uint8Array(0), { stream: false })
	reader.releaseLock()
	return result
}

export { CsvParseError }
