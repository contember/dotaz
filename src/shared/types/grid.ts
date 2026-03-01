// Grid data types for pagination, sorting, and filtering

import type { DatabaseDataType } from "./database";

export type SortDirection = "asc" | "desc";

export type FilterOperator =
	| "eq"
	| "neq"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "like"
	| "notLike"
	| "in"
	| "notIn"
	| "isNull"
	| "isNotNull";

export interface ColumnFilter {
	column: string;
	operator: FilterOperator;
	value: unknown;
}

export interface SortColumn {
	column: string;
	direction: SortDirection;
}

export interface GridDataRequest {
	connectionId: string;
	schema: string;
	table: string;
	page: number;
	pageSize: number;
	sort?: SortColumn[];
	filters?: ColumnFilter[];
	quickSearch?: string;
	database?: string;
}

export interface GridDataResponse {
	columns: GridColumnDef[];
	rows: Record<string, unknown>[];
	totalRows: number;
	page: number;
	pageSize: number;
}

export interface GridColumnDef {
	name: string;
	dataType: DatabaseDataType;
	nullable: boolean;
	isPrimaryKey: boolean;
}
