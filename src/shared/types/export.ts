// Export types

import type { ColumnFilter, SortColumn } from "./grid";

export type ExportFormat = "csv" | "json" | "sql";

export type CsvDelimiter = "," | ";" | "\t";

export interface ExportOptions {
	connectionId: string;
	schema: string;
	table: string;
	format: ExportFormat;
	database?: string;
	/** Target file path (from save dialog) */
	filePath: string;
	/** Column names to export (undefined = all) */
	columns?: string[];
	/** Include column headers (CSV only, default true) */
	includeHeaders?: boolean;
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter;
	/** Batch size for SQL INSERT (default: 100) */
	batchSize?: number;
	/** Active filters to apply */
	filters?: ColumnFilter[];
	/** Active sort to apply */
	sort?: SortColumn[];
	/** Limit rows to export (undefined = all) */
	limit?: number;
}

export interface ExportPreviewRequest {
	connectionId: string;
	schema: string;
	table: string;
	format: ExportFormat;
	database?: string;
	limit: number;
	/** Column names to preview (undefined = all) */
	columns?: string[];
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter;
	/** Active filters to apply */
	filters?: ColumnFilter[];
	/** Active sort to apply */
	sort?: SortColumn[];
}

export interface ExportResult {
	rowCount: number;
	filePath: string;
	sizeBytes: number;
}
