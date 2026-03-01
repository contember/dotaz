// Database metadata types

export interface DatabaseInfo {
	name: string;
	isDefault: boolean;
	isActive: boolean;
}

export interface SchemaInfo {
	name: string;
}

export interface TableInfo {
	schema: string;
	name: string;
	type: "table" | "view";
	rowCount?: number;
}

export interface ColumnInfo {
	name: string;
	dataType: string;
	nullable: boolean;
	defaultValue: string | null;
	isPrimaryKey: boolean;
	isAutoIncrement: boolean;
	maxLength?: number;
}

export interface IndexInfo {
	name: string;
	columns: string[];
	isUnique: boolean;
	isPrimary: boolean;
}

export interface ForeignKeyInfo {
	name: string;
	columns: string[];
	referencedSchema: string;
	referencedTable: string;
	referencedColumns: string[];
	onUpdate: string;
	onDelete: string;
}
