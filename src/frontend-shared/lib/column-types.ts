import { DatabaseDataType } from "../../shared/types/database";

const NUMERIC_TYPES = new Set<DatabaseDataType>([
	DatabaseDataType.Integer,
	DatabaseDataType.Serial,
	DatabaseDataType.Float,
	DatabaseDataType.Numeric,
]);

const BOOLEAN_TYPES = new Set<DatabaseDataType>([
	DatabaseDataType.Boolean,
]);

const DATE_TYPES = new Set<DatabaseDataType>([
	DatabaseDataType.Timestamp,
	DatabaseDataType.Date,
]);

const TEXT_TYPES = new Set<DatabaseDataType>([
	DatabaseDataType.Text,
	DatabaseDataType.Varchar,
	DatabaseDataType.Char,
]);

const JSON_TYPES = new Set<DatabaseDataType>([
	DatabaseDataType.Json,
]);

export function isNumericType(dataType: DatabaseDataType): boolean {
	return NUMERIC_TYPES.has(dataType);
}

export function isBooleanType(dataType: DatabaseDataType): boolean {
	return BOOLEAN_TYPES.has(dataType);
}

export function isDateType(dataType: DatabaseDataType): boolean {
	return DATE_TYPES.has(dataType);
}

export function isTextType(dataType: DatabaseDataType): boolean {
	return TEXT_TYPES.has(dataType);
}

export function isJsonType(dataType: DatabaseDataType): boolean {
	return JSON_TYPES.has(dataType);
}

export function isTimestampType(dataType: DatabaseDataType): boolean {
	return dataType === DatabaseDataType.Timestamp || dataType === DatabaseDataType.Date;
}

export type ColumnCategory = "text" | "number" | "boolean" | "other";

export function getColumnCategory(dataType: DatabaseDataType): ColumnCategory {
	if (BOOLEAN_TYPES.has(dataType)) return "boolean";
	if (NUMERIC_TYPES.has(dataType)) return "number";
	if (TEXT_TYPES.has(dataType)) return "text";
	return "other";
}

export function getDataTypeLabel(dataType: DatabaseDataType): string {
	switch (dataType) {
		case DatabaseDataType.Serial: return "SER";
		case DatabaseDataType.Integer: return "INT";
		case DatabaseDataType.Text:
		case DatabaseDataType.Varchar:
		case DatabaseDataType.Char: return "TXT";
		case DatabaseDataType.Boolean: return "BOOL";
		case DatabaseDataType.Timestamp: return "TS";
		case DatabaseDataType.Date: return "DATE";
		case DatabaseDataType.Time: return "TIME";
		case DatabaseDataType.Float:
		case DatabaseDataType.Numeric: return "NUM";
		case DatabaseDataType.Json: return "JSON";
		case DatabaseDataType.Uuid: return "UUID";
		case DatabaseDataType.Binary: return "BIN";
		case DatabaseDataType.Array: return "ARR";
		case DatabaseDataType.Enum: return "ENUM";
		case DatabaseDataType.Unknown: return "?";
	}
}
