// Import types

export type ImportFormat = "csv" | "json";

export type CsvDelimiter = "," | ";" | "\t";

export interface ColumnMapping {
	/** Column name from the source file */
	fileColumn: string;
	/** Column name in the target table (null = skip this column) */
	tableColumn: string | null;
}

/** Exactly one of fileContent or filePath must be provided. */
export type ImportSource =
	| { fileContent: string; filePath?: undefined }
	| { filePath: string; fileContent?: undefined };

export type ImportPreviewRequest = ImportSource & {
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
	format: ImportFormat;
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter;
	/** Whether the CSV has a header row (default: true) */
	hasHeader?: boolean;
	/** Max rows to preview */
	limit?: number;
};

export interface ImportPreviewResult {
	/** Column names detected from the file */
	fileColumns: string[];
	/** Preview rows (up to limit) */
	rows: Record<string, unknown>[];
	/** Total row count in the file (undefined when streaming — total unknown) */
	totalRows?: number;
	/** File size in bytes (when available from file path) */
	fileSizeBytes?: number;
}

export type ImportOptions = ImportSource & {
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
	sessionId?: string;
	format: ImportFormat;
	/** CSV delimiter (default: comma) */
	delimiter?: CsvDelimiter;
	/** Whether the CSV has a header row (default: true) */
	hasHeader?: boolean;
	/** Column mappings (file → table). Unmapped columns are skipped. */
	mappings: ColumnMapping[];
	/** Batch size for INSERT statements (default: 100) */
	batchSize?: number;
};

export interface ImportResult {
	rowCount: number;
}
