import { splitStatements } from '@dotaz/shared/sql/statements'
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
import type { DriverConnectionHandleInfo } from '@dotaz/shared/types/rpc'
import { SQL } from 'bun'
import type { DatabaseDriver, ReserveSessionOptions } from '../db/driver'
import { mapSqliteError } from '../db/error-mapping'
import { getAffectedRowCount } from '../db/result-utils'
import { safeCloseConnection, syncTxActive } from './driver-utils'

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

/**
 * A read-only session's own connection. SQLite has no per-session state on a shared
 * handle, so `PRAGMA query_only` needs a handle nobody else uses.
 */
interface ReadOnlyHandle {
	conn: SQL
	txActive: boolean
	iterating: boolean
	handleId: string
	createdAt: number
	lastUsedAt: number
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
	/** sessionId → dedicated read-only handle. Absent for normal sessions. */
	private readOnlySessions = new Map<string, ReadOnlyHandle>()
	private iterating = false
	/** Separate read-only connection used by iterate() so it doesn't block the main connection. */
	private iterateDb: SQL | null = null
	private iterateActive = false
	/** Optional setup SQL re-applied to every physical connection (main + iterate). */
	private initSql: string | null = null
	private mainHandleId: string | null = null
	private mainCreatedAt = 0
	private mainLastUsedAt = 0
	private iterateHandleId: string | null = null
	private iterateCreatedAt = 0
	private iterateLastUsedAt = 0
	private nextHandleNumber = 1

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'sqlite') {
			throw new Error('SqliteDriver requires a sqlite connection config')
		}
		const initSql = config.initSql?.trim() || null
		try {
			this.db = new SQL(`sqlite:${config.path}`)
			this.dbPath = config.path
			this.resetMainHandle()
			await this.db.unsafe('PRAGMA journal_mode = WAL')
			await this.db.unsafe('PRAGMA foreign_keys = ON')
			this.initSql = initSql
			await this.applyInitSql(this.db)
		} catch (err) {
			// Close the socket opened before the failure (e.g. a bad initSql) so a failed
			// connect never leaves a live handle behind.
			if (this.db) {
				try {
					await this.db.close()
				} catch { /* already dead */ }
			}
			this.db = null
			this.dbPath = null
			this.initSql = null
			this.mainHandleId = null
			this.mainCreatedAt = 0
			this.mainLastUsedAt = 0
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		this.connected = false
		for (const readOnly of this.readOnlySessions.values()) {
			await safeCloseConnection(readOnly.conn, { rollback: readOnly.txActive })
		}
		this.readOnlySessions.clear()
		if (this.iterateDb) {
			try {
				await this.iterateDb.close()
			} catch { /* best effort */ }
			this.iterateDb = null
			this.iterateHandleId = null
			this.iterateCreatedAt = 0
			this.iterateLastUsedAt = 0
			this.iterateActive = false
		}
		if (this.db) {
			await this.db.close()
			this.db = null
			this.dbPath = null
			this.initSql = null
			this.mainHandleId = null
			this.mainCreatedAt = 0
			this.mainLastUsedAt = 0
			this.txActive = false
			this.txOwnerSession = null
			this.sessionIds.clear()
		}
	}

	isConnected(): boolean {
		return this.connected
	}

	async reserveSession(sessionId: string, opts?: ReserveSessionOptions): Promise<void> {
		if (opts?.readOnly) {
			// statementTimeoutMs is ignored: SQLite has no statement timeout and bun:sqlite
			// exposes no interrupt or progress hook, so nothing can stop a running query.
			await this.openReadOnlyHandle(sessionId)
		}
		this.sessionIds.add(sessionId)
	}

	async releaseSession(sessionId: string): Promise<void> {
		const readOnly = this.readOnlySessions.get(sessionId)
		if (readOnly) {
			this.readOnlySessions.delete(sessionId)
			await safeCloseConnection(readOnly.conn, { rollback: readOnly.txActive })
			this.sessionIds.delete(sessionId)
			return
		}
		if (this.txActive && this.txOwnerSession === sessionId) {
			try {
				await this.db!.unsafe('ROLLBACK')
			} catch { /* ignore */ }
			this.txActive = false
			this.txOwnerSession = null
		}
		this.sessionIds.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessionIds]
	}

	isSessionReadOnly(sessionId: string): boolean {
		return this.readOnlySessions.has(sessionId)
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		this.ensureKnownSession(sessionId)

		const readOnly = sessionId === undefined ? undefined : this.readOnlySessions.get(sessionId)
		if (readOnly) {
			readOnly.lastUsedAt = Date.now()
			const result = await this.runStatement(readOnly.conn, sql, params)
			syncTxActive(readOnly, sql)
			return result
		}

		this.ensureSessionCanExecute(sessionId)
		this.markMainUsed()
		const result = await this.runStatement(this.db!, sql, params)

		// Sync txActive for raw transaction-control statements
		const upper = sql.trim().toUpperCase()
		if (/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)) {
			this.txActive = true
			this.txOwnerSession = sessionId ?? null
		} else if (/^(COMMIT|END)\b/.test(upper)) {
			this.txActive = false
			this.txOwnerSession = null
		} else if (/^ROLLBACK\b/.test(upper) && !/^ROLLBACK\s+TO\b/.test(upper)) {
			this.txActive = false
			this.txOwnerSession = null
		}

		return result
	}

	/** Run one statement on a specific handle and shape the driver result. */
	private async runStatement(conn: SQL, sql: string, params?: unknown[]): Promise<QueryResult> {
		const start = performance.now()
		try {
			const result = await conn.unsafe(sql, params ?? [])
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

	/**
	 * Open the session's own read-only handle so the shared connection stays writable.
	 *
	 * Read-only is set when the handle is opened, not by `PRAGMA query_only` — a pragma can be
	 * revoked from inside the session (`PRAGMA query_only(0)`), and the argument form carries
	 * no `=`, so statement classification reads it as a plain read. The pragma stays as a
	 * second layer.
	 */
	private async openReadOnlyHandle(sessionId: string): Promise<void> {
		this.ensureConnected()
		if (this.readOnlySessions.has(sessionId)) return
		if (!this.dbPath || this.dbPath === ':memory:') {
			throw new Error('Read-only sessions require a file-backed SQLite database')
		}
		const conn = new SQL({ adapter: 'sqlite', filename: this.dbPath, readonly: true })
		try {
			await conn.unsafe('PRAGMA foreign_keys = ON')
			await this.applyInitSql(conn)
			// Last, so initSql can still configure the handle
			await conn.unsafe('PRAGMA query_only = ON')
		} catch (err) {
			try {
				await conn.close()
			} catch { /* already dead */ }
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		const now = Date.now()
		this.readOnlySessions.set(sessionId, {
			conn,
			txActive: false,
			iterating: false,
			handleId: this.createHandleId(),
			createdAt: now,
			lastUsedAt: now,
		})
	}

	async cancel(_sessionId?: string, _poolQueryKey?: symbol): Promise<void> {
		// SQLite operations are synchronous under the hood;
		// cancellation is not supported.
	}

	async loadSchema(_sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()
		this.markMainUsed()

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
		this.markMainUsed()
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
		// A read-only session iterates on its own handle; for other file-based
		// databases, use a separate read-only connection so iteration doesn't block
		// the main connection (WAL mode allows concurrent readers). In-memory
		// databases can't share across connections, so they fall back to the main one.
		this.ensureKnownSession(sessionId)
		const readOnly = sessionId === undefined ? undefined : this.readOnlySessions.get(sessionId)
		const useMainConn = !readOnly && this.dbPath === ':memory:'
		let readConn: SQL
		if (readOnly) {
			if (readOnly.txActive) throw new Error('Cannot iterate with an active transaction')
			readConn = readOnly.conn
			readOnly.iterating = true
			readOnly.lastUsedAt = Date.now()
		} else if (useMainConn) {
			readConn = this.db!
			this.markMainUsed()
			this.ensureSessionCanExecute(sessionId)
			if (this.txActive) throw new Error('Cannot iterate with an active transaction')
			this.txActive = true
			this.txOwnerSession = sessionId ?? null
			this.iterating = true
		} else {
			readConn = await this.getIterateDb()
			this.iterateActive = true
			this.markIterateUsed()
		}
		await readConn.unsafe('BEGIN')
		let committed = false
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
			committed = true
		} catch (err) {
			try {
				await readConn.unsafe('ROLLBACK')
			} catch { /* ignore */ }
			throw err
		} finally {
			if (!committed) {
				try {
					await readConn.unsafe('ROLLBACK')
				} catch { /* ignore */ }
			}
			if (readOnly) {
				readOnly.iterating = false
				readOnly.lastUsedAt = Date.now()
			} else if (useMainConn) {
				this.iterating = false
				this.txActive = false
				this.txOwnerSession = null
			} else {
				this.iterateActive = false
				this.markIterateUsed()
			}
		}
	}

	/** Lazily open a separate read-only connection for iterate(). */
	private async getIterateDb(): Promise<SQL> {
		if (!this.iterateDb) {
			const conn = new SQL(`sqlite:${this.dbPath}`)
			try {
				await this.applyInitSql(conn)
			} catch (err) {
				try {
					await conn.close()
				} catch { /* already dead */ }
				throw err instanceof DatabaseError ? err : mapSqliteError(err)
			}
			this.iterateDb = conn
			this.resetIterateHandle()
		}
		return this.iterateDb
	}

	/**
	 * Apply the configured setup SQL to a connection, one statement at a time.
	 *
	 * SQLite's driver stops a multi-statement `unsafe()` call at the first
	 * result-returning statement (e.g. `PRAGMA busy_timeout = N` returns the new
	 * value), silently skipping the rest — so each statement must run on its own.
	 */
	private async applyInitSql(conn: SQL): Promise<void> {
		if (!this.initSql) return
		for (const stmt of splitStatements(this.initSql)) {
			await conn.unsafe(stmt)
		}
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
		this.ensureKnownSession(sessionId)
		const readOnly = sessionId === undefined ? undefined : this.readOnlySessions.get(sessionId)
		if (readOnly) {
			if (readOnly.txActive) throw new Error('A transaction is already active')
			await readOnly.conn.unsafe('BEGIN')
			readOnly.txActive = true
			readOnly.lastUsedAt = Date.now()
			return
		}
		this.markMainUsed()
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
		this.ensureKnownSession(sessionId)
		const readOnly = sessionId === undefined ? undefined : this.readOnlySessions.get(sessionId)
		if (readOnly) {
			if (!readOnly.txActive) throw new Error('No active transaction')
			if (readOnly.iterating) throw new Error('Cannot commit during active iteration')
			await readOnly.conn.unsafe('COMMIT')
			readOnly.txActive = false
			readOnly.lastUsedAt = Date.now()
			return
		}
		this.ensureSessionOwnsTx(sessionId)
		if (this.iterating) throw new Error('Cannot commit during active iteration')
		this.markMainUsed()
		await this.db!.unsafe('COMMIT')
		this.txActive = false
		this.txOwnerSession = null
	}

	async rollback(sessionId?: string): Promise<void> {
		this.ensureConnected()
		this.ensureKnownSession(sessionId)
		const readOnly = sessionId === undefined ? undefined : this.readOnlySessions.get(sessionId)
		if (readOnly) {
			if (!readOnly.txActive) throw new Error('No active transaction')
			if (readOnly.iterating) throw new Error('Cannot rollback during active iteration')
			try {
				await readOnly.conn.unsafe('ROLLBACK')
			} finally {
				readOnly.txActive = false
				readOnly.lastUsedAt = Date.now()
			}
			return
		}
		this.ensureSessionOwnsTx(sessionId)
		if (this.iterating) throw new Error('Cannot rollback during active iteration')
		this.markMainUsed()
		try {
			await this.db!.unsafe('ROLLBACK')
		} finally {
			this.txActive = false
			this.txOwnerSession = null
		}
	}

	inTransaction(sessionId?: string): boolean {
		if (sessionId !== undefined) {
			const readOnly = this.readOnlySessions.get(sessionId)
			if (readOnly) return readOnly.txActive
			return this.txActive && this.txOwnerSession === sessionId
		}
		return this.txActive && this.txOwnerSession === null
	}

	isTxAborted(_sessionId?: string): boolean {
		return false
	}

	isIterating(sessionId?: string): boolean {
		if (sessionId !== undefined) {
			const readOnly = this.readOnlySessions.get(sessionId)
			if (readOnly) return readOnly.iterating
		}
		return this.iterating
	}

	getDriverType(): 'sqlite' {
		return 'sqlite'
	}

	listConnectionHandles(): DriverConnectionHandleInfo[] {
		if (!this.connected || !this.db || !this.mainHandleId) return []
		const mainState: DriverConnectionHandleInfo['state'] = this.txActive
			? 'transaction'
			: (this.iterating ? 'active' : 'idle')
		const handles: DriverConnectionHandleInfo[] = [{
			handleId: this.mainHandleId,
			role: 'sqlite-main',
			state: mainState,
			createdAt: this.mainCreatedAt,
			lastUsedAt: this.mainLastUsedAt,
			activeQueryCount: 0,
			inTransaction: this.txActive,
			txAborted: false,
			iterating: this.iterating,
			canTerminate: true,
		}]

		if (this.iterateDb && this.iterateHandleId) {
			handles.push({
				handleId: this.iterateHandleId,
				role: 'sqlite-iterate',
				state: this.iterateActive ? 'active' : 'idle',
				createdAt: this.iterateCreatedAt,
				lastUsedAt: this.iterateLastUsedAt,
				activeQueryCount: this.iterateActive ? 1 : 0,
				inTransaction: this.iterateActive,
				txAborted: false,
				iterating: this.iterateActive,
				canTerminate: true,
			})
		}

		for (const [sessionId, readOnly] of this.readOnlySessions) {
			handles.push({
				handleId: readOnly.handleId,
				role: 'session',
				state: readOnly.txActive ? 'transaction' : (readOnly.iterating ? 'active' : 'idle'),
				label: 'Read-only session',
				sessionId,
				createdAt: readOnly.createdAt,
				lastUsedAt: readOnly.lastUsedAt,
				activeQueryCount: readOnly.iterating ? 1 : 0,
				inTransaction: readOnly.txActive,
				txAborted: false,
				iterating: readOnly.iterating,
				canTerminate: true,
			})
		}

		return handles
	}

	async terminateConnectionHandle(handleId: string): Promise<void> {
		this.ensureConnected()
		if (this.mainHandleId === handleId) {
			await this.reopenMainConnection()
			return
		}
		for (const [sessionId, readOnly] of this.readOnlySessions) {
			if (readOnly.handleId === handleId) {
				await this.releaseSession(sessionId)
				return
			}
		}
		if (this.iterateHandleId === handleId && this.iterateDb) {
			try {
				await this.iterateDb.close()
			} catch { /* already dead */ }
			this.iterateDb = null
			this.iterateHandleId = null
			this.iterateCreatedAt = 0
			this.iterateLastUsedAt = 0
			this.iterateActive = false
			return
		}
		throw new Error(`Connection handle not found: ${handleId}`)
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

	/**
	 * Reject a session id this driver never reserved. Without this, SQLite would fall through
	 * to the shared writable handle — silently downgrading a read-only session to read-write
	 * whenever its handle was lost (terminated, reconnected) or the id was simply made up.
	 * PostgreSQL and MySQL already throw for the same input.
	 */
	private ensureKnownSession(sessionId?: string): void {
		if (sessionId === undefined) return
		if (!this.sessionIds.has(sessionId)) {
			throw new Error(`Session "${sessionId}" not found`)
		}
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

	private async reopenMainConnection(): Promise<void> {
		const dbPath = this.dbPath
		if (!dbPath) throw new Error('SQLite path is not available')
		if (this.db) {
			try {
				await this.db.close()
			} catch { /* already dead */ }
		}
		const conn = new SQL(`sqlite:${dbPath}`)
		try {
			await conn.unsafe('PRAGMA journal_mode = WAL')
			await conn.unsafe('PRAGMA foreign_keys = ON')
			await this.applyInitSql(conn)
		} catch (err) {
			try {
				await conn.close()
			} catch { /* already dead */ }
			throw err instanceof DatabaseError ? err : mapSqliteError(err)
		}
		this.db = conn
		this.txActive = false
		this.txOwnerSession = null
		this.iterating = false
		this.resetMainHandle()
	}

	private resetMainHandle(): void {
		const now = Date.now()
		this.mainHandleId = this.createHandleId()
		this.mainCreatedAt = now
		this.mainLastUsedAt = now
	}

	private resetIterateHandle(): void {
		const now = Date.now()
		this.iterateHandleId = this.createHandleId()
		this.iterateCreatedAt = now
		this.iterateLastUsedAt = now
	}

	private createHandleId(): string {
		const id = `sqlite-${this.nextHandleNumber}`
		this.nextHandleNumber += 1
		return id
	}

	private markMainUsed(): void {
		this.mainLastUsedAt = Date.now()
	}

	private markIterateUsed(): void {
		this.iterateLastUsedAt = Date.now()
	}
}
