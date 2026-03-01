import { SQL } from "bun";
import type { ReservedSQL } from "bun";
import type { DatabaseDriver } from "./driver";
import type { ConnectionConfig } from "../../shared/types/connection";
import type { QueryResult, QueryResultColumn } from "../../shared/types/query";
import type {
	SchemaInfo,
	TableInfo,
	ColumnInfo,
	IndexInfo,
	ForeignKeyInfo,
} from "../../shared/types/database";

/**
 * Convert PostgreSQL-style $N placeholders to MySQL-style ? placeholders.
 * Respects quoted strings (single, double, backtick) and comments.
 */
function convertPlaceholders(sql: string): string {
	return sql.replace(/\$\d+/g, "?");
}

export class MysqlDriver implements DatabaseDriver {
	private db: SQL | null = null;
	private connected = false;
	private txActive = false;
	private reservedConn: ReservedSQL | null = null;
	private activeQuery: ReturnType<SQL["unsafe"]> | null = null;

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== "mysql") {
			throw new Error(
				"MysqlDriver requires a mysql connection config",
			);
		}
		const url = `mysql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${encodeURIComponent(config.database)}`;
		this.db = new SQL({ url });
		// Verify the connection works
		await this.db`SELECT 1`;
		this.connected = true;
	}

	async disconnect(): Promise<void> {
		if (this.reservedConn) {
			this.reservedConn.release();
			this.reservedConn = null;
		}
		if (this.db) {
			await this.db.close();
			this.db = null;
			this.connected = false;
			this.txActive = false;
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const start = performance.now();
		// Convert $N placeholders to ? for MySQL
		const mysqlSql = convertPlaceholders(sql);
		const query = conn.unsafe(mysqlSql, params ?? []);
		this.activeQuery = query;
		try {
			const result = await query;
			const durationMs = Math.round(performance.now() - start);
			const rows = [...result] as Record<string, unknown>[];

			const columns: QueryResultColumn[] =
				rows.length > 0
					? Object.keys(rows[0]).map((name) => ({
							name,
							dataType: "unknown",
						}))
					: [];

			return {
				columns,
				rows,
				rowCount: rows.length,
				affectedRows: (result as any).affectedRows ?? (result as any).count ?? 0,
				durationMs,
			};
		} finally {
			this.activeQuery = null;
		}
	}

	async cancel(): Promise<void> {
		if (this.activeQuery) {
			this.activeQuery.cancel();
			this.activeQuery = null;
		}
	}

	async getSchemas(): Promise<SchemaInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe("SELECT DATABASE() AS name");
		return [...rows] as SchemaInfo[];
	}

	async getTables(schema: string): Promise<TableInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = ?
			ORDER BY table_name`,
			[schema],
		);
		return [...rows].map((row: any) => ({
			schema,
			name: row.name,
			type: row.table_type === "VIEW" ? "view" : "table",
		}));
	}

	async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT
				c.COLUMN_NAME AS column_name,
				c.DATA_TYPE AS data_type,
				c.COLUMN_TYPE AS column_type,
				c.IS_NULLABLE AS is_nullable,
				c.COLUMN_DEFAULT AS column_default,
				c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
				c.COLUMN_KEY AS column_key,
				c.EXTRA AS extra
			FROM information_schema.columns c
			WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
			ORDER BY c.ORDINAL_POSITION`,
			[schema, table],
		);

		return [...rows].map((row: any) => ({
			name: row.column_name,
			dataType: row.column_type || row.data_type,
			nullable: row.is_nullable === "YES",
			defaultValue: row.column_default,
			isPrimaryKey: row.column_key === "PRI",
			isAutoIncrement: (row.extra ?? "").includes("auto_increment"),
			maxLength: row.character_maximum_length ?? undefined,
		}));
	}

	async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT
				INDEX_NAME AS index_name,
				NON_UNIQUE AS non_unique,
				GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS \`columns\`
			FROM information_schema.STATISTICS
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
			GROUP BY INDEX_NAME, NON_UNIQUE
			ORDER BY INDEX_NAME`,
			[schema, table],
		);

		return [...rows].map((row: any) => ({
			name: row.index_name,
			columns: typeof row.columns === "string" ? row.columns.split(",") : [row.columns],
			isUnique: row.non_unique === 0 || row.non_unique === "0",
			isPrimary: row.index_name === "PRIMARY",
		}));
	}

	async getForeignKeys(
		schema: string,
		table: string,
	): Promise<ForeignKeyInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT
				kcu.CONSTRAINT_NAME AS constraint_name,
				GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS \`columns\`,
				kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
				kcu.REFERENCED_TABLE_NAME AS referenced_table,
				GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS referenced_columns,
				rc.UPDATE_RULE AS on_update,
				rc.DELETE_RULE AS on_delete
			FROM information_schema.KEY_COLUMN_USAGE kcu
			JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
				ON rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
				AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
			WHERE kcu.TABLE_SCHEMA = ?
				AND kcu.TABLE_NAME = ?
				AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
			GROUP BY kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_SCHEMA,
				kcu.REFERENCED_TABLE_NAME, rc.UPDATE_RULE, rc.DELETE_RULE
			ORDER BY kcu.CONSTRAINT_NAME`,
			[schema, table],
		);

		return [...rows].map((row: any) => ({
			name: row.constraint_name,
			columns: typeof row.columns === "string" ? row.columns.split(",") : [row.columns],
			referencedSchema: row.referenced_schema,
			referencedTable: row.referenced_table,
			referencedColumns: typeof row.referenced_columns === "string"
				? row.referenced_columns.split(",")
				: [row.referenced_columns],
			onUpdate: row.on_update,
			onDelete: row.on_delete,
		}));
	}

	async getPrimaryKey(schema: string, table: string): Promise<string[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT COLUMN_NAME AS column_name
			FROM information_schema.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = ?
				AND TABLE_NAME = ?
				AND CONSTRAINT_NAME = 'PRIMARY'
			ORDER BY ORDINAL_POSITION`,
			[schema, table],
		);
		return [...rows].map((row: any) => row.column_name);
	}

	async beginTransaction(): Promise<void> {
		this.ensureConnected();
		const conn = await this.db!.reserve();
		try {
			await conn.unsafe("START TRANSACTION");
		} catch (err) {
			conn.release();
			throw err;
		}
		this.reservedConn = conn;
		this.txActive = true;
	}

	async commit(): Promise<void> {
		this.ensureConnected();
		if (!this.reservedConn) {
			throw new Error("No active transaction");
		}
		await this.reservedConn.unsafe("COMMIT");
		this.reservedConn.release();
		this.reservedConn = null;
		this.txActive = false;
	}

	async rollback(): Promise<void> {
		this.ensureConnected();
		if (!this.reservedConn) {
			throw new Error("No active transaction");
		}
		await this.reservedConn.unsafe("ROLLBACK");
		this.reservedConn.release();
		this.reservedConn = null;
		this.txActive = false;
	}

	inTransaction(): boolean {
		return this.txActive;
	}

	getDriverType(): "mysql" {
		return "mysql";
	}

	quoteIdentifier(name: string): string {
		return `\`${name.replace(/`/g, "``")}\``;
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} () VALUES ()`;
	}

	private ensureConnected(): void {
		if (!this.db || !this.connected) {
			throw new Error("Not connected. Call connect() first.");
		}
	}
}
