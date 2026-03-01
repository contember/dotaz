import { SQL } from "bun";
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

export class SqliteDriver implements DatabaseDriver {
	private db: SQL | null = null;
	private connected = false;
	private txActive = false;

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== "sqlite") {
			throw new Error("SqliteDriver requires a sqlite connection config");
		}
		this.db = new SQL(`sqlite:${config.path}`);
		await this.db.unsafe("PRAGMA journal_mode = WAL");
		await this.db.unsafe("PRAGMA foreign_keys = ON");
		this.connected = true;
	}

	async disconnect(): Promise<void> {
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
		const start = performance.now();
		const result = await this.db!.unsafe(sql, params ?? []);
		const durationMs = Math.round(performance.now() - start);
		const rows = [...result] as Record<string, unknown>[];

		const columns: QueryResultColumn[] =
			rows.length > 0
				? Object.keys(rows[0]).map((name) => ({ name, dataType: "unknown" }))
				: [];

		return {
			columns,
			rows,
			rowCount: rows.length,
			affectedRows: (result as any).count ?? 0,
			durationMs,
		};
	}

	async cancel(): Promise<void> {
		// SQLite operations are synchronous under the hood;
		// cancellation is not supported.
	}

	async getSchemas(): Promise<SchemaInfo[]> {
		return [{ name: "main" }];
	}

	async getTables(schema: string): Promise<TableInfo[]> {
		this.ensureConnected();
		const rows = await this.db!.unsafe(
			"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
		);
		return [...rows].map((row: any) => ({
			schema,
			name: row.name,
			type: row.type as "table" | "view",
		}));
	}

	async getColumns(_schema: string, table: string): Promise<ColumnInfo[]> {
		this.ensureConnected();
		const rows = [
			...(await this.db!.unsafe(
				`PRAGMA table_info(${this.quoteIdentifier(table)})`,
			)),
		] as any[];

		const pkCount = rows.filter((r) => r.pk > 0).length;

		return rows.map((row) => ({
			name: row.name,
			dataType: row.type || "BLOB",
			nullable: row.notnull === 0 && row.pk === 0,
			defaultValue: row.dflt_value,
			isPrimaryKey: row.pk > 0,
			isAutoIncrement:
				row.pk > 0 &&
				pkCount === 1 &&
				row.type?.toUpperCase() === "INTEGER",
		}));
	}

	async getIndexes(_schema: string, table: string): Promise<IndexInfo[]> {
		this.ensureConnected();
		const indexList = [
			...(await this.db!.unsafe(
				`PRAGMA index_list(${this.quoteIdentifier(table)})`,
			)),
		] as any[];

		const indexes: IndexInfo[] = [];
		for (const idx of indexList) {
			const indexInfo = [
				...(await this.db!.unsafe(
					`PRAGMA index_info(${this.quoteIdentifier(idx.name)})`,
				)),
			] as any[];
			indexes.push({
				name: idx.name,
				columns: indexInfo.map((col) => col.name),
				isUnique: idx.unique === 1,
				isPrimary: idx.origin === "pk",
			});
		}
		return indexes;
	}

	async getForeignKeys(
		_schema: string,
		table: string,
	): Promise<ForeignKeyInfo[]> {
		this.ensureConnected();
		const rows = [
			...(await this.db!.unsafe(
				`PRAGMA foreign_key_list(${this.quoteIdentifier(table)})`,
			)),
		] as any[];

		// Group by FK id since one FK can span multiple columns
		const fkMap = new Map<number, ForeignKeyInfo>();
		for (const row of rows) {
			const existing = fkMap.get(row.id);
			if (existing) {
				existing.columns.push(row.from);
				existing.referencedColumns.push(row.to);
			} else {
				fkMap.set(row.id, {
					name: `fk_${table}_${row.id}`,
					columns: [row.from],
					referencedSchema: "main",
					referencedTable: row.table,
					referencedColumns: [row.to],
					onUpdate: row.on_update,
					onDelete: row.on_delete,
				});
			}
		}
		return Array.from(fkMap.values());
	}

	async getPrimaryKey(_schema: string, table: string): Promise<string[]> {
		this.ensureConnected();
		const rows = [
			...(await this.db!.unsafe(
				`PRAGMA table_info(${this.quoteIdentifier(table)})`,
			)),
		] as any[];
		return rows
			.filter((row) => row.pk > 0)
			.sort((a, b) => a.pk - b.pk)
			.map((row) => row.name);
	}

	async beginTransaction(): Promise<void> {
		this.ensureConnected();
		await this.db!.unsafe("BEGIN");
		this.txActive = true;
	}

	async commit(): Promise<void> {
		this.ensureConnected();
		await this.db!.unsafe("COMMIT");
		this.txActive = false;
	}

	async rollback(): Promise<void> {
		this.ensureConnected();
		await this.db!.unsafe("ROLLBACK");
		this.txActive = false;
	}

	inTransaction(): boolean {
		return this.txActive;
	}

	getDriverType(): "sqlite" {
		return "sqlite";
	}

	quoteIdentifier(name: string): string {
		return `"${name.replace(/"/g, '""')}"`;
	}

	qualifyTable(schema: string, table: string): string {
		if (schema === "main") return this.quoteIdentifier(table);
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`;
	}

	private ensureConnected(): void {
		if (!this.db || !this.connected) {
			throw new Error("Not connected. Call connect() first.");
		}
	}
}
