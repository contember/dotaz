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
import { SQL } from 'bun'
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
	private dbPath: string | null = null
	private connected = false
	private txActive = false
	private txOwnerSession: string | null = null
	private sessionIds = new Set<string>()
	private iterating = false
	/** Separate read-only connection used by iterate() so it doesn't block the main connection. */
	private iterateDb: SQL | null = null

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'sqlite') {
			throw new Error('SqliteDriver requires a sqlite connection config')
		}
		try {
			this.db = new SQL(`sqlite:${config.path}`)
			this.dbPath = config.path
			await this.db.unsafe('PRAGMA journal_mode = WAL')
			await this.db.unsafe('PRAGMA foreign_keys = ON')
		} catch (err) {
			this.db = null
			this.dbPath = null
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		this.connected = false
		if (this.iterateDb) {
			try { await this.iterateDb.close() } catch { /* best effort */ }
			this.iterateDb = null
		}
		if (this.db) {
			await this.db.close()
			this.db = null
			this.dbPath = null
			this.txActive = false
			this.txOwnerSession = null
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
		if (this.txActive && this.txOwnerSession === sessionId) {
			try { await this.db!.unsafe('ROLLBACK') } catch { /* ignore */ }
			this.txActive = false
			this.txOwnerSession = null
		}
		this.sessionIds.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessionIds]
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		this.ensureSessionCanExecute(sessionId)
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

	async ping(): Promise<void> {
		this.ensureConnected()
		await this.db!.unsafe('SELECT 1')
	}

	async *iterate(
		sql: string,
		params?: unknown[],
		batchSize = 1000,
		signal?: AbortSignal,
		sessionId?: string,
	): AsyncGenerator<Record<string, unknown>[]> {
		this.ensureConnected()
		// For file-based databases, use a separate read-only connection so
		// iteration doesn't block the main connection (WAL mode allows
		// concurrent readers). In-memory databases can't share across
		// connections, so they must fall back to the main connection.
		const useMainConn = this.dbPath === ':memory:'
		const readConn = useMainConn ? this.db! : this.getIterateDb()
		if (useMainConn) {
			this.ensureSessionCanExecute(sessionId)
			if (this.txActive) throw new Error('Cannot iterate with an active transaction')
			this.txActive = true
			this.txOwnerSession = sessionId ?? null
			this.iterating = true
		}
		await readConn.unsafe('BEGIN')
		try {
			let offset = 0
			while (true) {
				if (signal?.aborted) {
					throw new DOMException('Aborted', 'AbortError')
				}
				const pagedSql = `${sql} LIMIT ? OFFSET ?`
				const result = await readConn.unsafe(pagedSql, [...(params ?? []), batchSize, offset])
				const rows = [...result] as Record<string, unknown>[]
				if (rows.length === 0) break
				yield rows
				if (rows.length < batchSize) break
				offset += batchSize
			}
			await readConn.unsafe('COMMIT')
		} catch (err) {
			try { await readConn.unsafe('ROLLBACK') } catch { /* ignore */ }
			throw err
		} finally {
			try { await readConn.unsafe('ROLLBACK') } catch { /* ignore */ }
			if (useMainConn) {
				this.iterating = false
				this.txActive = false
				this.txOwnerSession = null
			}
		}
	}

	/** Lazily open a separate read-only connection for iterate(). */
	private getIterateDb(): SQL {
		if (!this.iterateDb) {
			this.iterateDb = new SQL(`sqlite:${this.dbPath}`)
		}
		return this.iterateDb
	}

	async importBatch(
		qualifiedTable: string,
		columns: string[],
		rows: Record<string, unknown>[],
		sessionId?: string,
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
		const result = await this.execute(sql, allParams, sessionId)
		return result.affectedRows ?? rows.length
	}

	async beginTransaction(sessionId?: string): Promise<void> {
		this.ensureConnected()
		if (this.txActive) {
			throw new Error(
				sessionId && this.txOwnerSession !== sessionId
					? `Another session ("${this.txOwnerSession}") already has an active transaction`
					: 'A transaction is already active',
			)
		}
		await this.db!.unsafe('BEGIN')
		this.txActive = true
		this.txOwnerSession = sessionId ?? null
	}

	async commit(sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.ensureSessionOwnsTx(sessionId)
		if (this.iterating) throw new Error('Cannot commit during active iteration')
		await this.db!.unsafe('COMMIT')
		this.txActive = false
		this.txOwnerSession = null
	}

	async rollback(sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.ensureSessionOwnsTx(sessionId)
		if (this.iterating) throw new Error('Cannot rollback during active iteration')
		try {
			await this.db!.unsafe('ROLLBACK')
		} finally {
			this.txActive = false
			this.txOwnerSession = null
		}
	}

	inTransaction(sessionId?: string): boolean {
		if (sessionId !== undefined) {
			return this.txActive && this.txOwnerSession === sessionId
		}
		return this.txActive && this.txOwnerSession === null
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

	private ensureSessionCanExecute(sessionId?: string): void {
		if (!this.txActive) return
		if (this.iterating) {
			throw new Error('Cannot execute: iteration is in progress on the shared connection')
		}
		// Sessionless TX: block all session-scoped callers
		if (this.txOwnerSession === null) {
			if (sessionId !== undefined) {
				throw new Error(
					'Cannot execute: a sessionless transaction is active. SQLite uses a single connection shared by all sessions.',
				)
			}
			return
		}
		// Session-owned TX: block other sessions and sessionless callers
		if (sessionId === undefined || sessionId !== this.txOwnerSession) {
			throw new Error(
				`Cannot execute: session "${this.txOwnerSession}" has an active transaction. SQLite uses a single connection shared by all sessions.`,
			)
		}
	}

	private ensureSessionOwnsTx(sessionId?: string): void {
		if (!this.txActive) {
			throw new Error('No active transaction')
		}
		const callerOwns = sessionId === undefined
			? this.txOwnerSession === null
			: this.txOwnerSession === sessionId
		if (!callerOwns) {
			throw new Error(
				`Cannot modify transaction owned by ${this.txOwnerSession === null ? 'sessionless caller' : `session "${this.txOwnerSession}"`}`,
			)
		}
	}

	private ensureConnected(): void {
		if (!this.db || !this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}
}
