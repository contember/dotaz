// Query execution and history types

import type { DatabaseDataType } from "./database";

export interface QueryRequest {
	connectionId: string;
	sql: string;
	params?: unknown[];
}

export interface QueryResultColumn {
	name: string;
	dataType: DatabaseDataType;
}

export interface ErrorPosition {
	line?: number;
	column?: number;
	offset?: number;
}

export interface QueryResult {
	columns: QueryResultColumn[];
	rows: Record<string, unknown>[];
	rowCount: number;
	affectedRows?: number;
	durationMs: number;
	error?: string;
	errorCode?: import("./errors").DatabaseErrorCode;
	errorPosition?: ErrorPosition;
}

export type QueryHistoryStatus = "success" | "error";

export interface QueryHistoryEntry {
	id: number;
	connectionId: string;
	sql: string;
	status: QueryHistoryStatus;
	durationMs?: number;
	rowCount?: number;
	errorMessage?: string;
	executedAt: string;
}
