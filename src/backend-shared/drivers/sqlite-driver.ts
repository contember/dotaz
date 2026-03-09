import { SQL } from 'bun'
import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { ColumnInfo, ForeignKeyInfo, IndexInfo, ReferencingForeignKeyInfo, SchemaData, SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import type { DatabaseDriver } from '../db/driver'
import { mapSqliteError } from '../db/error-mapping'
import { getAffectedRowCount } from '../db/result-utils'

/** Row shape from sqlite_master */
interface SqliteMasterRow {
	name: string
	type: string
}

/** Row shape from PRAGMA table_info */
interface SqlitePragmaTableInfoRow {
	name: string
	type: string
	notnull: number
	dflt_value: string | null
	pk: number
}

/** Row shape from PRAGMA index_list */
interface SqlitePragmaIndexListRow {
	name: string
	unique: number
	origin: string
}

/** Row shape from PRAGMA index_info */
interface SqlitePragmaIndexInfoRow {
	name: string
}

/** Row shape from PRAGMA foreign_key_list */
interface SqlitePragmaForeignKeyRow {
	id: number
	from: string
	to: string
	table: string
	on_update: string
	on_delete: string
}

/** Map SQLite type affinity strings to DatabaseDataType. */
function mapSqliteDataType(type: string): DatabaseDataType {
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

export class SqliteDriver implements DatabaseDriver {
	private db: SQL | null = null
	private connected = false
	private txActive = false
	private sessionIds = new Set<string>()

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'sqlite') {
			throw new Error('SqliteDriver requires a sqlite connection config')
		}
		try {
			this.db = new SQL(`sqlite:${config.path}`)
			await this.db.unsafe('PRAGMA journal_mode = WAL')
			await this.db.unsafe('PRAGMA foreign_keys = ON')
		} catch (err) {
			this.db = null
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		if (this.db) {
			await this.db.close()
			this.db = null
			this.connected = false
			this.txActive = false
			this.sessionIds.clear()
		}
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
			const result = await this.db!.unsafe(sql, params ?? [])
			const durationMs = Math.round(performance.now() - start)
			const rows = [...result] as Record<string, unknown>[]

			const columns: QueryResultColumn[] = rows.length > 0
				? Object.keys(rows[0]).map((name) => ({ name, dataType: DatabaseDataType.Unknown }))
				: []

			return {
				columns,
				rows,
				rowCount: rows.length,
				affectedRows: getAffectedRowCount(result),
				durationMs,
			}
		} catch (err) {
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
	}

	async cancel(_sessionId?: string): Promise<void> {
		// SQLite operations are synchronous under the hood;
		// cancellation is not supported.
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

			// Get FKs and also build referencing FK data
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
		const rows = await this.db!.unsafe(
			"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		return [...rows].map((row: SqliteMasterRow) => ({
			schema,
			name: row.name,
			type: row.type as 'table' | 'view',
		}))
	}

	private async getColumns(_schema: string, table: string): Promise<ColumnInfo[]> {
		this.ensureConnected()
		const rows = [
			...(await this.db!.unsafe(
				`PRAGMA table_info(${this.quoteIdentifier(table)})`,
			)),
		] as SqlitePragmaTableInfoRow[]

		const pkCount = rows.filter((r) => r.pk > 0).length

		return rows.map((row) => ({
			name: row.name,
			dataType: mapSqliteDataType(row.type || 'BLOB'),
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
		const indexList = [
			...(await this.db!.unsafe(
				`PRAGMA index_list(${this.quoteIdentifier(table)})`,
			)),
		] as SqlitePragmaIndexListRow[]

		const indexes: IndexInfo[] = []
		for (const idx of indexList) {
			const indexInfo = [
				...(await this.db!.unsafe(
					`PRAGMA index_info(${this.quoteIdentifier(idx.name)})`,
				)),
			] as SqlitePragmaIndexInfoRow[]
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
		const rows = [
			...(await this.db!.unsafe(
				`PRAGMA foreign_key_list(${this.quoteIdentifier(table)})`,
			)),
		] as SqlitePragmaForeignKeyRow[]

		// Group by FK id since one FK can span multiple columns
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
			const pagedSql = `${sql} LIMIT ? OFFSET ?`
			const result = await this.db!.unsafe(pagedSql, [...(params ?? []), batchSize, offset])
			const rows = [...result] as Record<string, unknown>[]
			if (rows.length === 0) break
			yield rows
			if (rows.length < batchSize) break
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
		await this.db!.unsafe('BEGIN')
		this.txActive = true
	}

	async commit(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		await this.db!.unsafe('COMMIT')
		this.txActive = false
	}

	async rollback(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		await this.db!.unsafe('ROLLBACK')
		this.txActive = false
	}

	inTransaction(_sessionId?: string): boolean {
		return this.txActive
	}

	getDriverType(): 'sqlite' {
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
		if (!this.db || !this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}
}
