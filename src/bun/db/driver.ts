import type { ConnectionConfig, ConnectionType } from "../../shared/types/connection";
import type { QueryResult } from "../../shared/types/query";
import type {
	SchemaInfo,
	TableInfo,
	ColumnInfo,
	IndexInfo,
	ForeignKeyInfo,
} from "../../shared/types/database";

export interface DatabaseDriver {
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
	getPrimaryKey(schema: string, table: string): Promise<string[]>;

	// Transactions
	beginTransaction(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	inTransaction(): boolean;

	// Metadata
	getDriverType(): ConnectionType;
	quoteIdentifier(name: string): string;

	// SQL generation helpers
	qualifyTable(schema: string, table: string): string;
	emptyInsertSql(qualifiedTable: string): string;
}
