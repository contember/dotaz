import type {
	ComparisonColumnMapping,
	ComparisonResult,
	ComparisonStats,
	DiffRow,
} from "./types/comparison";

/** Maximum rows to compare to prevent OOM. */
export const MAX_COMPARISON_ROWS = 10_000;

interface SourceData {
	columns: string[];
	rows: Record<string, unknown>[];
}

/**
 * Auto-map columns by matching names (case-insensitive).
 */
export function autoMapColumns(leftColumns: string[], rightColumns: string[]): ComparisonColumnMapping[] {
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
 * Compare pre-fetched data from two sources and produce a diff result.
 */
export function compareData(
	left: SourceData,
	right: SourceData,
	keyColumns: ComparisonColumnMapping[],
	columnMappings?: ComparisonColumnMapping[],
): ComparisonResult {
	// Determine column mappings
	const resolvedMappings = columnMappings && columnMappings.length > 0
		? columnMappings
		: autoMapColumns(left.columns, right.columns);

	if (keyColumns.length === 0) {
		throw new Error("At least one key column is required for matching rows");
	}

	// Validate key columns exist in data
	const leftKeyColumns = keyColumns.map((k) => k.leftColumn);
	const rightKeyColumns = keyColumns.map((k) => k.rightColumn);

	for (const col of leftKeyColumns) {
		if (!left.columns.includes(col)) {
			throw new Error(`Key column "${col}" not found in left source`);
		}
	}
	for (const col of rightKeyColumns) {
		if (!right.columns.includes(col)) {
			throw new Error(`Key column "${col}" not found in right source`);
		}
	}

	// Index right rows by key
	const rightIndex = new Map<string, Record<string, unknown>>();
	for (const row of right.rows) {
		const key = buildRowKey(row, rightKeyColumns);
		rightIndex.set(key, row);
	}

	// Track which right keys were matched
	const matchedRightKeys = new Set<string>();

	const diffRows: DiffRow[] = [];
	const stats: ComparisonStats = { matched: 0, added: 0, removed: 0, changed: 0, total: 0 };

	// Process left rows
	for (const leftRow of left.rows) {
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
			for (const mapping of resolvedMappings) {
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
	for (const rightRow of right.rows) {
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
		leftColumns: left.columns,
		rightColumns: right.columns,
		columnMappings: resolvedMappings,
		rows: diffRows,
		stats,
	};
}
