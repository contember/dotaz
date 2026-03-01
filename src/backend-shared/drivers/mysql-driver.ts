import { SQL } from "bun";
import type { ReservedSQL } from "bun";
import type { DatabaseDriver } from "../db/driver";
import type { ConnectionConfig } from "../../shared/types/connection";
import type { QueryResult, QueryResultColumn } from "../../shared/types/query";
import type {
	SchemaInfo,
	SchemaData,
	TableInfo,
} from "../../shared/types/database";
import { getAffectedRowCount } from "../db/result-utils";

/** Row shape from information_schema.columns */
interface MysqlColumnRow {
	table_schema: string;
	table_name: string;
	column_name: string;
	data_type: string;
	column_type: string;
	is_nullable: string;
	column_default: string | null;
	character_maximum_length: number | null;
	column_key: string;
	extra: string;
}

/** Row shape from information_schema.STATISTICS */
interface MysqlIndexRow {
	table_schema: string;
	table_name: string;
	index_name: string;
	non_unique: number | string;
	columns: string;
}

/** Row shape from FK join query */
interface MysqlForeignKeyRow {
	table_schema: string;
	table_name: string;
	constraint_name: string;
	columns: string;
	referenced_schema: string;
	referenced_table: string;
	referenced_columns: string;
	on_update: string;
	on_delete: string;
}

/** Row shape from referencing FK query */
interface MysqlReferencingFkRow {
	referenced_schema: string;
	referenced_table: string;
	constraint_name: string;
	referencing_schema: string;
	referencing_table: string;
	referencing_columns: string;
	referenced_columns: string;
}

/** Row shape from information_schema.tables */
interface MysqlTableRow {
	name: string;
	table_type: string;
}

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
				affectedRows: getAffectedRowCount(result),
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

	async loadSchema(): Promise<SchemaData> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;

		const schemas = await this.getSchemas();
		const schemaNames = schemas.map((s) => s.name);

		const tables: SchemaData["tables"] = {};
		for (const schema of schemas) {
			tables[schema.name] = await this.getTables(schema.name);
		}

		const [allColumns, allIndexes, allForeignKeys, allReferencingForeignKeys] = await Promise.all([
			// All columns
			conn.unsafe(
				`SELECT
					c.TABLE_SCHEMA AS table_schema,
					c.TABLE_NAME AS table_name,
					c.COLUMN_NAME AS column_name,
					c.DATA_TYPE AS data_type,
					c.COLUMN_TYPE AS column_type,
					c.IS_NULLABLE AS is_nullable,
					c.COLUMN_DEFAULT AS column_default,
					c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
					c.COLUMN_KEY AS column_key,
					c.EXTRA AS extra
				FROM information_schema.columns c
				WHERE c.TABLE_SCHEMA IN (${schemaNames.map(() => "?").join(",")})
				ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
				schemaNames,
			),
			// All indexes
			conn.unsafe(
				`SELECT
					TABLE_SCHEMA AS table_schema,
					TABLE_NAME AS table_name,
					INDEX_NAME AS index_name,
					NON_UNIQUE AS non_unique,
					GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS \`columns\`
				FROM information_schema.STATISTICS
				WHERE TABLE_SCHEMA IN (${schemaNames.map(() => "?").join(",")})
				GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE
				ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME`,
				schemaNames,
			),
			// All foreign keys
			conn.unsafe(
				`SELECT
					kcu.TABLE_SCHEMA AS table_schema,
					kcu.TABLE_NAME AS table_name,
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
				WHERE kcu.TABLE_SCHEMA IN (${schemaNames.map(() => "?").join(",")})
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				GROUP BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME,
					kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
					rc.UPDATE_RULE, rc.DELETE_RULE
				ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME`,
				schemaNames,
			),
			// All referencing foreign keys
			conn.unsafe(
				`SELECT
					kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
					kcu.REFERENCED_TABLE_NAME AS referenced_table,
					kcu.CONSTRAINT_NAME AS constraint_name,
					kcu.TABLE_SCHEMA AS referencing_schema,
					kcu.TABLE_NAME AS referencing_table,
					GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS referencing_columns,
					GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS referenced_columns
				FROM information_schema.KEY_COLUMN_USAGE kcu
				WHERE kcu.REFERENCED_TABLE_SCHEMA IN (${schemaNames.map(() => "?").join(",")})
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				GROUP BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
					kcu.CONSTRAINT_NAME, kcu.TABLE_SCHEMA, kcu.TABLE_NAME
				ORDER BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.CONSTRAINT_NAME`,
				schemaNames,
			),
		]);

		// Group columns by schema.table
		const columns: SchemaData["columns"] = {};
		for (const row of allColumns as MysqlColumnRow[]) {
			const key = `${row.table_schema}.${row.table_name}`;
			if (!columns[key]) columns[key] = [];
			columns[key].push({
				name: row.column_name,
				dataType: row.column_type || row.data_type,
				nullable: row.is_nullable === "YES",
				defaultValue: row.column_default,
				isPrimaryKey: row.column_key === "PRI",
				isAutoIncrement: (row.extra ?? "").includes("auto_increment"),
				maxLength: row.character_maximum_length ?? undefined,
			});
		}

		// Group indexes by schema.table
		const indexes: SchemaData["indexes"] = {};
		for (const row of allIndexes as MysqlIndexRow[]) {
			const key = `${row.table_schema}.${row.table_name}`;
			if (!indexes[key]) indexes[key] = [];
			indexes[key].push({
				name: row.index_name,
				columns: typeof row.columns === "string" ? row.columns.split(",") : [row.columns],
				isUnique: row.non_unique === 0 || row.non_unique === "0",
				isPrimary: row.index_name === "PRIMARY",
			});
		}

		// Group foreign keys by schema.table
		const foreignKeys: SchemaData["foreignKeys"] = {};
		for (const row of allForeignKeys as MysqlForeignKeyRow[]) {
			const key = `${row.table_schema}.${row.table_name}`;
			if (!foreignKeys[key]) foreignKeys[key] = [];
			foreignKeys[key].push({
				name: row.constraint_name,
				columns: typeof row.columns === "string" ? row.columns.split(",") : [row.columns],
				referencedSchema: row.referenced_schema,
				referencedTable: row.referenced_table,
				referencedColumns: typeof row.referenced_columns === "string"
					? row.referenced_columns.split(",")
					: [row.referenced_columns],
				onUpdate: row.on_update,
				onDelete: row.on_delete,
			});
		}

		// Group referencing foreign keys by schema.table (the referenced table)
		const referencingForeignKeys: SchemaData["referencingForeignKeys"] = {};
		for (const row of allReferencingForeignKeys as MysqlReferencingFkRow[]) {
			const key = `${row.referenced_schema}.${row.referenced_table}`;
			if (!referencingForeignKeys[key]) referencingForeignKeys[key] = [];
			referencingForeignKeys[key].push({
				constraintName: row.constraint_name,
				referencingSchema: row.referencing_schema,
				referencingTable: row.referencing_table,
				referencingColumns: typeof row.referencing_columns === "string"
					? row.referencing_columns.split(",")
					: [row.referencing_columns],
				referencedColumns: typeof row.referenced_columns === "string"
					? row.referenced_columns.split(",")
					: [row.referenced_columns],
			});
		}

		// Ensure every table has entries (even if empty)
		for (const schema of schemas) {
			for (const table of tables[schema.name]) {
				const key = `${schema.name}.${table.name}`;
				if (!columns[key]) columns[key] = [];
				if (!indexes[key]) indexes[key] = [];
				if (!foreignKeys[key]) foreignKeys[key] = [];
				if (!referencingForeignKeys[key]) referencingForeignKeys[key] = [];
			}
		}

		return { schemas, tables, columns, indexes, foreignKeys, referencingForeignKeys };
	}

	private async getSchemas(): Promise<SchemaInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe("SELECT DATABASE() AS name");
		return [...rows] as SchemaInfo[];
	}

	private async getTables(schema: string): Promise<TableInfo[]> {
		this.ensureConnected();
		const conn = this.reservedConn ?? this.db!;
		const rows = await conn.unsafe(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = ?
			ORDER BY table_name`,
			[schema],
		);
		return [...rows].map((row: MysqlTableRow) => ({
			schema,
			name: row.name,
			type: row.table_type === "VIEW" ? ("view" as const) : ("table" as const),
		}));
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
