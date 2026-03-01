/**
 * Extract DML affected row count from Bun.SQL query results.
 * Bun.SQL attaches count/affectedRows properties to result objects at runtime,
 * but these aren't declared in the TypeScript types.
 */
export function getAffectedRowCount(result: object): number {
	const r = result as Record<string, unknown>;
	if (typeof r.affectedRows === "number") return r.affectedRows;
	if (typeof r.count === "number") return r.count;
	return 0;
}
