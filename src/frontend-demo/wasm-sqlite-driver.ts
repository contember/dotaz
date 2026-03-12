import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type {
	ColumnInfo,
	ForeignKeyInfo,
	IndexInfo,
	ReferencingForeignKeyInfo,
	SchemaData,
	SchemaInfo,
	TableInfo,
} from '@dotaz/shared/types/database'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'

/** Map SQLite type affinity strings to DatabaseDataType. */
function mapWasmSqliteDataType(type: string): DatabaseDataType {
	const t = type.toUpperCase()
	if (t === 'INTEGER' || t === 'INT' || t === 'BIGINT' || t === 'SMALLINT' || t === 'TINYINT' || t === 'MEDIUMINT') return DatabaseDataType.Integer
	if (t === 'REAL' || t === 'FLOAT' || t === 'DOUBLE') return DatabaseDataType.Float
	if (t === 'NUMERIC' || t === 'DECIMAL') return DatabaseDataType.Numeric
	if (t === 'BOOLEAN' || t === 'BOOL') return DatabaseDataType.Boolean
	if (t === 'TEXT') return DatabaseDataType.Text
	if (t.includes('VARCHAR') || t.includes('VARYING')) return DatabaseDataType.Varchar
	if (t.includes('CHAR') && !t.includes('VARCHAR')) return DatabaseDataType.Char
	if (t === 'DATE') return DatabaseDataType.Date
	if (t === 'TIME') return DatabaseDataType.Time
	if (t === 'DATETIME' || t.includes('TIMESTAMP')) return DatabaseDataType.Timestamp
	if (t === 'JSON' || t === 'JSONB') return DatabaseDataType.Json
	if (t === 'BLOB' || t === 'BINARY' || t.includes('VARBINARY')) return DatabaseDataType.Binary
	return DatabaseDataType.Unknown
}

/**
 * DatabaseDriver implementation backed by @sqlite.org/sqlite-wasm OO1 API.
 * Runs entirely in the browser — no server needed.
 */
export class WasmSqliteDriver implements DatabaseDriver {
	private connected = false
	private txActive = false
	private sessionIds = new Set<string>()

	constructor(private db: any) {
		this.connected = true
	}

	async connect(_config: ConnectionConfig): Promise<void> {
		// DB is already loaded via the constructor
		this.connected = true
	}

	async disconnect(): Promise<void> {
		this.connected = false
		this.txActive = false
		this.sessionIds.clear()
	}

	isConnected(): boolean {
		return this.connected
	}

	async reserveSession(sessionId: string): Promise<void> {
		this.sessionIds.add(sessionId)
	}

	async releaseSession(sessionId: string): Promise<void> {
		this.sessionIds.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessionIds]
	}

	async execute(sql: string, params?: unknown[], _sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		const start = performance.now()

		try {
			const resultRows: Record<string, unknown>[] = []
			this.db.exec({
				sql,
				bind: params && params.length > 0 ? params : undefined,
				rowMode: 'object',
				resultRows,
			})

			// Simulate network latency so the UI behaves like a real DB connection
			await new Promise(resolve => setTimeout(resolve, 100))

			const durationMs = Math.round(performance.now() - start)

			const columns: QueryResultColumn[] = resultRows.length > 0
				? Object.keys(resultRows[0]).map((name) => ({ name, dataType: DatabaseDataType.Unknown }))
				: []

			return {
				columns,
				rows: resultRows,
				rowCount: resultRows.length,
				affectedRows: this.db.changes(),
				durationMs,
			}
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)
			// Re-throw with duration info available to caller
			const error = err instanceof Error ? err : new Error(String(err))
			;(error as any).durationMs = durationMs
			throw error
		}
	}

	async cancel(_sessionId?: string): Promise<void> {
		// WASM SQLite operations are synchronous; cancellation not supported
	}

	async ping(): Promise<void> {
		this.ensureConnected()
		this.db.exec('SELECT 1')
	}

	async loadSchema(_sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()

		const schemas = await this.getSchemas()
		const schemaName = schemas[0].name
		const tableList = await this.getTables(schemaName)

		const tables: SchemaData['tables'] = { [schemaName]: tableList }
		const columns: SchemaData['columns'] = {}
		const indexes: SchemaData['indexes'] = {}
		const foreignKeys: SchemaData['foreignKeys'] = {}
		const referencingForeignKeys: SchemaData['referencingForeignKeys'] = {}

		// Build referencing FK map from forward FK scan
		const refFkMap = new Map<string, ReferencingForeignKeyInfo[]>()

		for (const table of tableList) {
			const key = `${schemaName}.${table.name}`

			columns[key] = await this.getColumns(schemaName, table.name)
			indexes[key] = await this.getIndexes(schemaName, table.name)

			const fks = await this.getForeignKeys(schemaName, table.name)
			foreignKeys[key] = fks

			// For each FK, record the reverse reference
			for (const fk of fks) {
				const refKey = `${fk.referencedSchema}.${fk.referencedTable}`
				if (!refFkMap.has(refKey)) refFkMap.set(refKey, [])
				refFkMap.get(refKey)!.push({
					constraintName: fk.name,
					referencingSchema: schemaName,
					referencingTable: table.name,
					referencingColumns: fk.columns,
					referencedColumns: fk.referencedColumns,
				})
			}
		}

		// Assign referencing FKs
		for (const table of tableList) {
			const key = `${schemaName}.${table.name}`
			referencingForeignKeys[key] = refFkMap.get(key) ?? []
		}

		return { schemas, tables, columns, indexes, foreignKeys, referencingForeignKeys }
	}

	private async getSchemas(): Promise<SchemaInfo[]> {
		return [{ name: 'main' }]
	}

	private async getTables(schema: string): Promise<TableInfo[]> {
		this.ensureConnected()
		const rows: any[] = []
		this.db.exec({
			sql: "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
			rowMode: 'object',
			resultRows: rows,
		})
		return rows.map((row: any) => ({
			schema,
			name: row.name,
			type: row.type as 'table' | 'view',
		}))
	}

	private async getColumns(_schema: string, table: string): Promise<ColumnInfo[]> {
		this.ensureConnected()
		const rows: any[] = []
		this.db.exec({
			sql: `PRAGMA table_info(${this.quoteIdentifier(table)})`,
			rowMode: 'object',
			resultRows: rows,
		})

		const pkCount = rows.filter((r) => r.pk > 0).length

		return rows.map((row) => ({
			name: row.name,
			dataType: mapWasmSqliteDataType(row.type || 'BLOB'),
			nullable: row.notnull === 0 && row.pk === 0,
			defaultValue: row.dflt_value,
			isPrimaryKey: row.pk > 0,
			isAutoIncrement: row.pk > 0
				&& pkCount === 1
				&& row.type?.toUpperCase() === 'INTEGER',
		}))
	}

	private async getIndexes(_schema: string, table: string): Promise<IndexInfo[]> {
		this.ensureConnected()
		const indexList: any[] = []
		this.db.exec({
			sql: `PRAGMA index_list(${this.quoteIdentifier(table)})`,
			rowMode: 'object',
			resultRows: indexList,
		})

		const indexes: IndexInfo[] = []
		for (const idx of indexList) {
			const indexInfo: any[] = []
			this.db.exec({
				sql: `PRAGMA index_info(${this.quoteIdentifier(idx.name)})`,
				rowMode: 'object',
				resultRows: indexInfo,
			})
			indexes.push({
				name: idx.name,
				columns: indexInfo.map((col) => col.name),
				isUnique: idx.unique === 1,
				isPrimary: idx.origin === 'pk',
			})
		}
		return indexes
	}

	private async getForeignKeys(
		_schema: string,
		table: string,
	): Promise<ForeignKeyInfo[]> {
		this.ensureConnected()
		const rows: any[] = []
		this.db.exec({
			sql: `PRAGMA foreign_key_list(${this.quoteIdentifier(table)})`,
			rowMode: 'object',
			resultRows: rows,
		})

		const fkMap = new Map<number, ForeignKeyInfo>()
		for (const row of rows) {
			const existing = fkMap.get(row.id)
			if (existing) {
				existing.columns.push(row.from)
				existing.referencedColumns.push(row.to)
			} else {
				fkMap.set(row.id, {
					name: `fk_${table}_${row.id}`,
					columns: [row.from],
					referencedSchema: 'main',
					referencedTable: row.table,
					referencedColumns: [row.to],
					onUpdate: row.on_update,
					onDelete: row.on_delete,
				})
			}
		}
		return Array.from(fkMap.values())
	}

	async *iterate(
		sql: string,
		params?: unknown[],
		batchSize = 1000,
		signal?: AbortSignal,
		_sessionId?: string,
	): AsyncGenerator<Record<string, unknown>[]> {
		this.ensureConnected()
		let offset = 0
		while (true) {
			if (signal?.aborted) {
				throw new DOMException('Aborted', 'AbortError')
			}
			const pagedSql = `${sql} LIMIT ${batchSize} OFFSET ${offset}`
			const resultRows: Record<string, unknown>[] = []
			this.db.exec({
				sql: pagedSql,
				bind: params && params.length > 0 ? params : undefined,
				rowMode: 'object',
				resultRows,
			})
			if (resultRows.length === 0) break
			yield resultRows
			if (resultRows.length < batchSize) break
			offset += batchSize
		}
	}

	async importBatch(
		qualifiedTable: string,
		columns: string[],
		rows: Record<string, unknown>[],
		_sessionId?: string,
	): Promise<number> {
		this.ensureConnected()
		if (rows.length === 0) return 0
		const quotedCols = columns.map((c) => this.quoteIdentifier(c)).join(', ')
		const allParams: unknown[] = []
		const valueTuples: string[] = []
		for (let i = 0; i < rows.length; i++) {
			const placeholders: string[] = []
			for (let j = 0; j < columns.length; j++) {
				allParams.push(rows[i][columns[j]])
				placeholders.push(this.placeholder(allParams.length))
			}
			valueTuples.push(`(${placeholders.join(', ')})`)
		}
		const sql = `INSERT INTO ${qualifiedTable} (${quotedCols}) VALUES ${valueTuples.join(', ')}`
		const result = await this.execute(sql, allParams)
		return result.affectedRows ?? rows.length
	}

	async beginTransaction(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.db.exec('BEGIN')
		this.txActive = true
	}

	async commit(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.db.exec('COMMIT')
		this.txActive = false
	}

	async rollback(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.db.exec('ROLLBACK')
		this.txActive = false
	}

	inTransaction(_sessionId?: string): boolean {
		return this.txActive
	}

	isIterating(_sessionId?: string): boolean {
		return false
	}

	getDriverType(): 'postgresql' | 'sqlite' {
		return 'sqlite'
	}

	quoteIdentifier(name: string): string {
		return `"${name.replace(/"/g, '""')}"`
	}

	qualifyTable(schema: string, table: string): string {
		if (schema === 'main') return this.quoteIdentifier(table)
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`
	}

	placeholder(index: number): string {
		return `$${index}`
	}

	private ensureConnected(): void {
		if (!this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}
}
