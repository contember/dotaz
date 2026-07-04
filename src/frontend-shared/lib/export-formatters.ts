import { formatAll } from '@dotaz/shared/export/formatters'
import type { CsvDelimiter, ExportFormat } from '@dotaz/shared/types/export'

export interface PreviewFormatOptions {
	qualifiedTableName?: string
	quoteIdentifier?: (name: string) => string
	keyColumns?: string[]
}

export function formatPreview(
	rows: Record<string, unknown>[] | null,
	columns: string[],
	format: ExportFormat,
	delimiter: CsvDelimiter,
	includeHeaders: boolean,
	batchSize: number,
	schema: string,
	table: string,
	options?: PreviewFormatOptions,
): string {
	if (!rows || rows.length === 0) return ''
	return formatAll(rows, columns, {
		format,
		schema,
		table,
		delimiter,
		includeHeaders,
		batchSize,
		qualifiedTableName: options?.qualifiedTableName,
		quoteIdentifier: options?.quoteIdentifier,
		keyColumns: options?.keyColumns,
	})
}
