// Export types

import type { ColumnFilter, SortColumn } from './grid'

export type ExportFormat = 'csv' | 'json' | 'sql' | 'markdown' | 'sql_update' | 'html' | 'xml'

export type CsvDelimiter = ',' | ';' | '\t'

export type CsvEncoding = 'utf-8' | 'iso-8859-1' | 'windows-1252'

export interface ExportOptions {
	connectionId: string
	schema: string
	table: string
	format: ExportFormat
	database?: string
	sessionId?: string
	/** Target file path (from save dialog). Optional in demo mode. */
	filePath?: string
	/** Column names to export (undefined = all) */
	columns?: string[]
	/** Include column headers (CSV only, default true) */
	includeHeaders?: boolean
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter
	/** CSV character encoding (default: utf-8) */
	encoding?: CsvEncoding
	/** Include UTF-8 BOM (CSV only, default false) */
	utf8Bom?: boolean
	/** Batch size for SQL INSERT (default: 100) */
	batchSize?: number
	/** Active filters to apply */
	filters?: ColumnFilter[]
	/** Active sort to apply */
	sort?: SortColumn[]
	/** Limit rows to export (undefined = all) */
	limit?: number
}

export interface ExportPreviewRequest {
	connectionId: string
	schema: string
	table: string
	format: ExportFormat
	database?: string
	sessionId?: string
	limit: number
	/** Column names to preview (undefined = all) */
	columns?: string[]
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter
	/** Active filters to apply */
	filters?: ColumnFilter[]
	/** Active sort to apply */
	sort?: SortColumn[]
}

export interface ExportRawPreviewRequest {
	connectionId: string
	schema: string
	table: string
	database?: string
	sessionId?: string
	limit: number
	columns?: string[]
	filters?: ColumnFilter[]
	sort?: SortColumn[]
}

export interface ExportRawPreviewResponse {
	rows: Record<string, unknown>[]
	columns: string[]
}

export interface ExportResult {
	rowCount: number
	filePath?: string
	sizeBytes: number
}
