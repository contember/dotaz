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
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync } from 'node:fs'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { mapSqliteError } from '@dotaz/backend-shared/db/error-mapping'

interface SqliteMasterRow {
	name: string
	type: string
}

interface SqlitePragmaTableInfoRow {
	name: string
	type: string
	notnull: number
	dflt_value: string | null
	pk: number
}

interface SqlitePragmaIndexListRow {
	name: string
	unique: number
	origin: string
}

interface SqlitePragmaIndexInfoRow {
	name: string
}

interface SqlitePragmaForeignKeyRow {
	id: number
	from: string
	to: string
	table: string
	on_update: string
	on_delete: string
}

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

/** Execute a sql.js statement and return rows as objects. */
function queryAll(db: SqlJsDatabase, sql: string, params?: unknown[]): Record<string, unknown>[] {
	const stmt = db.prepare(sql)
	if (params?.length) stmt.bind(params as any)
	const rows: Record<string, unknown>[] = []
	while (stmt.step()) {
		rows.push(stmt.getAsObject() as Record<string, unknown>)
	}
	stmt.free()
	return rows
}

/** Detect if a SQL statement is a read (SELECT/PRAGMA/EXPLAIN) vs write. */
function isReadStatement(sql: string): boolean {
	const trimmed = sql.trimStart().toUpperCase()
	return trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN') || trimmed.startsWith('WITH')
}

export class NodeSqliteDriver implements DatabaseDriver {
	private db: SqlJsDatabase | null = null
	private dbPath: string | null = null
	private connected = false
	private txActive = false
	private sessionIds = new Set<string>()

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'sqlite') {
			throw new Error('NodeSqliteDriver requires a sqlite connection config')
		}
		try {
			const SQL = await initSqlJs()
			try {
				const buf = readFileSync(config.path)
				this.db = new SQL.Database(buf)
			} catch {
				// File doesn't exist yet — create empty database
				this.db = new SQL.Database()
			}
			this.dbPath = config.path
			this.db.run('PRAGMA journal_mode = WAL')
			this.db.run('PRAGMA foreign_keys = ON')
		} catch (err) {
			this.db = null
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		if (this.db) {
			this.persist()
			this.db.close()
			this.db = null
			this.dbPath = null
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
			if (isReadStatement(sql)) {
				const rows = queryAll(this.db!, sql, params)
				const durationMs = Math.round(performance.now() - start)
				const columns: QueryResultColumn[] = rows.length > 0
					? Object.keys(rows[0]).map((name) => ({ name, dataType: DatabaseDataType.Unknown }))
					: []
				return { columns, rows, rowCount: rows.length, durationMs }
			} else {
				this.db!.run(sql, params as any)
				const changes = this.db!.getRowsModified()
				const durationMs = Math.round(performance.now() - start)
				if (!this.txActive) this.persist()
				return {
					columns: [],
					rows: [],
					rowCount: 0,
					affectedRows: changes,
					durationMs,
				}
			}
		} catch (err) {
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
	}

	async cancel(_sessionId?: string): Promise<void> {
		// SQLite operations are synchronous; cancellation is not supported.
	}

	async loadSchema(_sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()

		const schemas: SchemaInfo[] = [{ name: 'main' }]
		const schemaName = 'main'
		const tableList = this.getTables(schemaName)

		const tables: SchemaData['tables'] = { [schemaName]: tableList }
		const columns: SchemaData['columns'] = {}
		const indexes: SchemaData['indexes'] = {}
		const foreignKeys: SchemaData['foreignKeys'] = {}
		const referencingForeignKeys: SchemaData['referencingForeignKeys'] = {}

		const refFkMap = new Map<string, ReferencingForeignKeyInfo[]>()

		for (const table of tableList) {
			const key = `${schemaName}.${table.name}`

			columns[key] = this.getColumns(schemaName, table.name)
			indexes[key] = this.getIndexes(schemaName, table.name)

			const fks = this.getForeignKeys(schemaName, table.name)
			foreignKeys[key] = fks

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

		for (const table of tableList) {
			const key = `${schemaName}.${table.name}`
			referencingForeignKeys[key] = refFkMap.get(key) ?? []
		}

		return { schemas, tables, columns, indexes, foreignKeys, referencingForeignKeys }
	}

	private getTables(schema: string): TableInfo[] {
		this.ensureConnected()
		const rows = queryAll(
			this.db!,
			"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
		) as unknown as SqliteMasterRow[]
		return rows.map((row) => ({
			schema,
			name: row.name,
			type: row.type as 'table' | 'view',
		}))
	}

	private getColumns(_schema: string, table: string): ColumnInfo[] {
		this.ensureConnected()
		const rows = queryAll(
			this.db!,
			`PRAGMA table_info(${this.quoteIdentifier(table)})`,
		) as unknown as SqlitePragmaTableInfoRow[]

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

	private getIndexes(_schema: string, table: string): IndexInfo[] {
		this.ensureConnected()
		const indexList = queryAll(
			this.db!,
			`PRAGMA index_list(${this.quoteIdentifier(table)})`,
		) as unknown as SqlitePragmaIndexListRow[]

		const indexes: IndexInfo[] = []
		for (const idx of indexList) {
			const indexInfo = queryAll(
				this.db!,
				`PRAGMA index_info(${this.quoteIdentifier(idx.name)})`,
			) as unknown as SqlitePragmaIndexInfoRow[]
			indexes.push({
				name: idx.name,
				columns: indexInfo.map((col) => col.name),
				isUnique: idx.unique === 1,
				isPrimary: idx.origin === 'pk',
			})
		}
		return indexes
	}

	private getForeignKeys(_schema: string, table: string): ForeignKeyInfo[] {
		this.ensureConnected()
		const rows = queryAll(
			this.db!,
			`PRAGMA foreign_key_list(${this.quoteIdentifier(table)})`,
		) as unknown as SqlitePragmaForeignKeyRow[]

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
			const rows = queryAll(this.db!, pagedSql, [...(params ?? []), batchSize, offset])
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
		this.db!.run('BEGIN')
		this.txActive = true
	}

	async commit(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.db!.run('COMMIT')
		this.txActive = false
		this.persist()
	}

	async rollback(_sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.db!.run('ROLLBACK')
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

	private persist(): void {
		if (this.db && this.dbPath) {
			const data = this.db.export()
			writeFileSync(this.dbPath, data)
		}
	}

	private ensureConnected(): void {
		if (!this.db || !this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}
}
