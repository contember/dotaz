// Database metadata types

/**
 * Sentinel value representing SQL DEFAULT — the database column's default value.
 * Used in pending changes to generate `SET col = DEFAULT` in UPDATE
 * or `DEFAULT` in INSERT column lists.
 */
export const SQL_DEFAULT = Object.freeze({ __dotaz_sentinel: 'DEFAULT' } as const)
export type SqlDefault = typeof SQL_DEFAULT

/** Type guard: returns true if the value is the SQL_DEFAULT sentinel. */
export function isSqlDefault(value: unknown): value is SqlDefault {
	return (
		typeof value === 'object'
		&& value !== null
		&& '__dotaz_sentinel' in value
		&& (value as Record<string, unknown>).__dotaz_sentinel === 'DEFAULT'
	)
}

/** Canonical data type categories for compile-time type classification. */
export enum DatabaseDataType {
	Integer = 'integer',
	Serial = 'serial',
	Float = 'float',
	Numeric = 'numeric',
	Boolean = 'boolean',
	Text = 'text',
	Varchar = 'varchar',
	Char = 'char',
	Date = 'date',
	Time = 'time',
	Timestamp = 'timestamp',
	Json = 'json',
	Uuid = 'uuid',
	Binary = 'binary',
	Array = 'array',
	Enum = 'enum',
	Unknown = 'unknown',
}

export interface DatabaseInfo {
	name: string
	isDefault: boolean
	isActive: boolean
}

export interface SchemaInfo {
	name: string
}

export interface TableInfo {
	schema: string
	name: string
	type: 'table' | 'view'
	rowCount?: number
}

export interface ColumnInfo {
	name: string
	dataType: DatabaseDataType
	nullable: boolean
	defaultValue: string | null
	isPrimaryKey: boolean
	isAutoIncrement: boolean
	maxLength?: number
}

export interface IndexInfo {
	name: string
	columns: string[]
	isUnique: boolean
	isPrimary: boolean
}

export interface ForeignKeyInfo {
	name: string
	columns: string[]
	referencedSchema: string
	referencedTable: string
	referencedColumns: string[]
	onUpdate: string
	onDelete: string
}

export interface ReferencingForeignKeyInfo {
	constraintName: string
	/** Schema of the table that has the FK pointing to this table */
	referencingSchema: string
	/** Table that has the FK pointing to this table */
	referencingTable: string
	/** FK column(s) in the referencing table */
	referencingColumns: string[]
	/** Column(s) in this table being referenced */
	referencedColumns: string[]
}

/** Consolidated schema data returned by schema.load endpoint. */
export interface SchemaData {
	schemas: SchemaInfo[]
	/** Tables per schema name */
	tables: Record<string, TableInfo[]>
	/** Columns per "schema.table" key */
	columns: Record<string, ColumnInfo[]>
	/** Indexes per "schema.table" key */
	indexes: Record<string, IndexInfo[]>
	/** Foreign keys per "schema.table" key */
	foreignKeys: Record<string, ForeignKeyInfo[]>
	/** Referencing foreign keys per "schema.table" key */
	referencingForeignKeys: Record<string, ReferencingForeignKeyInfo[]>
}
