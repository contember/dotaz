import type { DatabaseDriver } from "../db/driver";
import type {
	ComparisonSource,
	ComparisonRequest,
	ComparisonResult,
	ComparisonColumnMapping,
	DiffRow,
	ComparisonStats,
} from "../../shared/types/comparison";
import type { QueryResult } from "../../shared/types/query";

/** Maximum rows to fetch from each source to prevent OOM. */
const MAX_ROWS = 10_000;

interface SourceData {
	columns: string[];
	rows: Record<string, unknown>[];
}

/**
 * Fetch all rows from a comparison source.
 */
async function fetchSourceData(driver: DatabaseDriver, source: ComparisonSource): Promise<SourceData> {
	let result: QueryResult;

	if (source.type === "table") {
		if (!source.schema || !source.table) {
			throw new Error("Schema and table are required for table source");
		}
		const qualified = driver.qualifyTable(source.schema, source.table);
		result = await driver.execute(`SELECT * FROM ${qualified} LIMIT ${MAX_ROWS + 1}`);
	} else {
		if (!source.sql) {
			throw new Error("SQL query is required for query source");
		}
		// Wrap in a subquery to enforce limit
		result = await driver.execute(source.sql);
	}

	if (result.error) {
		throw new Error(result.error);
	}

	const columns = result.columns.map((c) => c.name);
	const rows = result.rows.slice(0, MAX_ROWS) as Record<string, unknown>[];

	return { columns, rows };
}

/**
 * Auto-map columns by matching names (case-insensitive).
 */
function autoMapColumns(leftColumns: string[], rightColumns: string[]): ComparisonColumnMapping[] {
	const rightLower = new Map(rightColumns.map((c) => [c.toLowerCase(), c]));
	const mappings: ComparisonColumnMapping[] = [];
	for (const left of leftColumns) {
		const match = rightLower.get(left.toLowerCase());
		if (match) {
			mappings.push({ leftColumn: left, rightColumn: match });
		}
	}
	return mappings;
}

/**
 * Build a composite key string from row values for the given key column mappings.
 */
function buildRowKey(row: Record<string, unknown>, columns: string[]): string {
	return columns.map((col) => {
		const val = row[col];
		if (val === null || val === undefined) return "\0NULL";
		return String(val);
	}).join("\0");
}

/**
 * Compare cell values, treating nulls carefully.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || a === undefined) return b === null || b === undefined;
	if (b === null || b === undefined) return false;
	// Compare by string representation for non-primitive types
	if (typeof a === "object" || typeof b === "object") {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	// Numeric comparison (handle string vs number)
	if (typeof a === "number" || typeof b === "number") {
		return Number(a) === Number(b);
	}
	return String(a) === String(b);
}

/**
 * Compare data from two sources and produce a diff result.
 */
export async function compareData(
	leftDriver: DatabaseDriver,
	rightDriver: DatabaseDriver,
	request: ComparisonRequest,
): Promise<ComparisonResult> {
	// Fetch data from both sources
	const [leftData, rightData] = await Promise.all([
		fetchSourceData(leftDriver, request.left),
		fetchSourceData(rightDriver, request.right),
	]);

	// Determine column mappings
	const columnMappings = request.columnMappings && request.columnMappings.length > 0
		? request.columnMappings
		: autoMapColumns(leftData.columns, rightData.columns);

	if (request.keyColumns.length === 0) {
		throw new Error("At least one key column is required for matching rows");
	}

	// Validate key columns exist in data
	const leftKeyColumns = request.keyColumns.map((k) => k.leftColumn);
	const rightKeyColumns = request.keyColumns.map((k) => k.rightColumn);

	for (const col of leftKeyColumns) {
		if (!leftData.columns.includes(col)) {
			throw new Error(`Key column "${col}" not found in left source`);
		}
	}
	for (const col of rightKeyColumns) {
		if (!rightData.columns.includes(col)) {
			throw new Error(`Key column "${col}" not found in right source`);
		}
	}

	// Index right rows by key
	const rightIndex = new Map<string, Record<string, unknown>>();
	for (const row of rightData.rows) {
		const key = buildRowKey(row, rightKeyColumns);
		rightIndex.set(key, row);
	}

	// Track which right keys were matched
	const matchedRightKeys = new Set<string>();

	const diffRows: DiffRow[] = [];
	const stats: ComparisonStats = { matched: 0, added: 0, removed: 0, changed: 0, total: 0 };

	// Process left rows
	for (const leftRow of leftData.rows) {
		const key = buildRowKey(leftRow, leftKeyColumns);
		const rightRow = rightIndex.get(key);

		if (!rightRow) {
			// Row only in left → removed
			diffRows.push({
				status: "removed",
				leftValues: leftRow,
				rightValues: null,
				changedColumns: [],
			});
			stats.removed++;
		} else {
			matchedRightKeys.add(key);

			// Compare mapped columns
			const changedColumns: string[] = [];
			for (const mapping of columnMappings) {
				const leftVal = leftRow[mapping.leftColumn];
				const rightVal = rightRow[mapping.rightColumn];
				if (!valuesEqual(leftVal, rightVal)) {
					changedColumns.push(mapping.leftColumn);
				}
			}

			if (changedColumns.length > 0) {
				diffRows.push({
					status: "changed",
					leftValues: leftRow,
					rightValues: rightRow,
					changedColumns,
				});
				stats.changed++;
			} else {
				diffRows.push({
					status: "matched",
					leftValues: leftRow,
					rightValues: rightRow,
					changedColumns: [],
				});
				stats.matched++;
			}
		}
	}

	// Process right-only rows (added)
	for (const rightRow of rightData.rows) {
		const key = buildRowKey(rightRow, rightKeyColumns);
		if (!matchedRightKeys.has(key)) {
			diffRows.push({
				status: "added",
				leftValues: null,
				rightValues: rightRow,
				changedColumns: [],
			});
			stats.added++;
		}
	}

	stats.total = stats.matched + stats.added + stats.removed + stats.changed;

	// Sort: removed first, then changed, then added, then matched
	const statusOrder: Record<string, number> = { removed: 0, changed: 1, added: 2, matched: 3 };
	diffRows.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

	return {
		leftColumns: leftData.columns,
		rightColumns: rightData.columns,
		columnMappings,
		rows: diffRows,
		stats,
	};
}
