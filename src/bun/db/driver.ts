import type { ConnectionConfig } from "../../shared/types/connection";
import type { SqlDialect } from "../../shared/sql/dialect";
import type { QueryResult } from "../../shared/types/query";
import type {
	SchemaInfo,
	TableInfo,
	ColumnInfo,
	IndexInfo,
	ForeignKeyInfo,
	ReferencingForeignKeyInfo,
} from "../../shared/types/database";

export interface DatabaseDriver extends SqlDialect {
	// Lifecycle
	connect(config: ConnectionConfig): Promise<void>;
	disconnect(): Promise<void>;
	isConnected(): boolean;

	// Query execution
	execute(sql: string, params?: unknown[]): Promise<QueryResult>;
	cancel(): Promise<void>;

	// Schema introspection
	getSchemas(): Promise<SchemaInfo[]>;
	getTables(schema: string): Promise<TableInfo[]>;
	getColumns(schema: string, table: string): Promise<ColumnInfo[]>;
	getIndexes(schema: string, table: string): Promise<IndexInfo[]>;
	getForeignKeys(schema: string, table: string): Promise<ForeignKeyInfo[]>;
	getReferencingForeignKeys(schema: string, table: string): Promise<ReferencingForeignKeyInfo[]>;
	getPrimaryKey(schema: string, table: string): Promise<string[]>;

	// Transactions
	beginTransaction(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	inTransaction(): boolean;
}
