import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { SchemaData, SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import { SQL } from 'bun'
import type { ReservedSQL } from 'bun'
import type { DatabaseDriver } from '../db/driver'
import { mapMysqlError } from '../db/error-mapping'
import { getAffectedRowCount } from '../db/result-utils'

/** Row shape from information_schema.columns */
interface MysqlColumnRow {
	table_schema: string
	table_name: string
	column_name: string
	data_type: string
	column_type: string
	is_nullable: string
	column_default: string | null
	character_maximum_length: number | null
	column_key: string
	extra: string
}

/** Row shape from information_schema.STATISTICS */
interface MysqlIndexRow {
	table_schema: string
	table_name: string
	index_name: string
	non_unique: number | string
	columns: string
}

/** Row shape from FK join query */
interface MysqlForeignKeyRow {
	table_schema: string
	table_name: string
	constraint_name: string
	columns: string
	referenced_schema: string
	referenced_table: string
	referenced_columns: string
	on_update: string
	on_delete: string
}

/** Row shape from referencing FK query */
interface MysqlReferencingFkRow {
	referenced_schema: string
	referenced_table: string
	constraint_name: string
	referencing_schema: string
	referencing_table: string
	referencing_columns: string
	referenced_columns: string
}

/** Row shape from information_schema.tables */
interface MysqlTableRow {
	name: string
	table_type: string
}

interface SessionState {
	conn: ReservedSQL
	txActive: boolean
	iterating: boolean
	activeQueries: Set<ReturnType<SQL['unsafe']>>
}

/** Internal session ID used for backward-compatible beginTransaction() without sessionId */
const DEFAULT_SESSION = '__default__'

/** Detect connection-level errors (TCP drop, reset, etc.) as opposed to protocol errors. */
function isConnectionLevelError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err)
	return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|connection (terminated|ended|closed|lost|reset)|socket.*(closed|hang up|end)|write after end|broken pipe|network/i
		.test(message)
}

/** Map MySQL information_schema data_type to DatabaseDataType. */
function mapMysqlDataType(dataType: string): DatabaseDataType {
	switch (dataType.toLowerCase()) {
		case 'int':
		case 'integer':
		case 'bigint':
		case 'smallint':
		case 'tinyint':
		case 'mediumint':
			return DatabaseDataType.Integer
		case 'float':
		case 'double':
			return DatabaseDataType.Float
		case 'decimal':
		case 'numeric':
			return DatabaseDataType.Numeric
		case 'bit':
		case 'boolean':
		case 'bool':
			return DatabaseDataType.Boolean
		case 'text':
		case 'tinytext':
		case 'mediumtext':
		case 'longtext':
			return DatabaseDataType.Text
		case 'varchar':
			return DatabaseDataType.Varchar
		case 'char':
			return DatabaseDataType.Char
		case 'date':
			return DatabaseDataType.Date
		case 'time':
			return DatabaseDataType.Time
		case 'datetime':
		case 'timestamp':
			return DatabaseDataType.Timestamp
		case 'json':
			return DatabaseDataType.Json
		case 'binary':
		case 'varbinary':
		case 'blob':
		case 'tinyblob':
		case 'mediumblob':
		case 'longblob':
			return DatabaseDataType.Binary
		case 'enum':
		case 'set':
			return DatabaseDataType.Enum
		default:
			return DatabaseDataType.Unknown
	}
}

export class MysqlDriver implements DatabaseDriver {
	private db: SQL | null = null
	private connected = false
	private sessions = new Map<string, SessionState>()
	private poolActiveQueries = new Map<symbol, ReturnType<SQL['unsafe']>>()
	/** Server's global default isolation level, queried on connect. */
	private defaultIsolationLevel = 'REPEATABLE READ'

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'mysql') {
			throw new Error(
				'MysqlDriver requires a mysql connection config',
			)
		}
		const url = `mysql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${
			encodeURIComponent(config.database)
		}`
		this.db = new SQL({ url })
		// Verify the connection works and cache the server's default isolation level
		try {
			await this.db`SELECT 1`
			const isoResult = await this.db.unsafe('SELECT @@GLOBAL.transaction_isolation AS level')
			const level = [...isoResult][0]?.level as string | undefined
			if (level) {
				this.defaultIsolationLevel = level.replace(/-/g, ' ')
			}
		} catch (err) {
			this.db = null
			throw err instanceof DatabaseError ? err : mapMysqlError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		this.connected = false

		// Release all sessions
		for (const [, session] of this.sessions) {
			if (session.txActive) {
				try {
					await session.conn.unsafe('ROLLBACK')
				} catch { /* ignore */ }
			}
			try { await this.resetConnection(session.conn) } catch { /* connection may be broken */ }
			session.conn.release()
		}
		this.sessions.clear()

		if (this.db) {
			await this.db.close()
			this.db = null
		}
	}

	isConnected(): boolean {
		return this.connected
	}

	async reserveSession(sessionId: string): Promise<void> {
		this.ensureConnected()
		if (this.sessions.has(sessionId)) {
			throw new Error(`Session "${sessionId}" already exists`)
		}
		const conn = await this.db!.reserve()
		this.sessions.set(sessionId, { conn, txActive: false, iterating: false, activeQueries: new Set() })
	}

	async releaseSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session "${sessionId}" not found`)
		}
		if (session.txActive) {
			try {
				await session.conn.unsafe('ROLLBACK')
			} catch { /* ignore */ }
		}
		try { await this.resetConnection(session.conn) } catch { /* connection may be broken */ }
		session.conn.release()
		this.sessions.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessions.keys()].filter((id) => id !== DEFAULT_SESSION)
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.db!
		const start = performance.now()
		const query = conn.unsafe(sql, params ?? [])
		const queryKey = session ? undefined : Symbol()
		if (session) {
			session.activeQueries.add(query)
		} else {
			this.poolActiveQueries.set(queryKey!, query)
		}
		try {
			const result = await query
			const durationMs = Math.round(performance.now() - start)
			const rows = [...result] as Record<string, unknown>[]

			const columns: QueryResultColumn[] = rows.length > 0
				? Object.keys(rows[0]).map((name) => ({
					name,
					dataType: DatabaseDataType.Unknown,
				}))
				: []

			return {
				columns,
				rows,
				rowCount: rows.length,
				affectedRows: getAffectedRowCount(result),
				durationMs,
			}
		} catch (err) {
			throw err instanceof DatabaseError ? err : mapMysqlError(err)
		} finally {
			if (session) {
				session.activeQueries.delete(query)
			} else {
				this.poolActiveQueries.delete(queryKey!)
			}
		}
	}

	async cancel(sessionId?: string): Promise<void> {
		if (sessionId) {
			const session = this.sessions.get(sessionId)
			if (session) {
				for (const query of session.activeQueries) {
					query.cancel()
				}
				session.activeQueries.clear()
			}
		} else {
			for (const query of this.poolActiveQueries.values()) {
				query.cancel()
			}
			this.poolActiveQueries.clear()
		}
	}

	async loadSchema(sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.db!

		const schemas = await this.getSchemas(conn)
		const schemaNames = schemas.map((s) => s.name)

		const tables: SchemaData['tables'] = {}
		for (const schema of schemas) {
			tables[schema.name] = await this.getTables(conn, schema.name)
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
				WHERE c.TABLE_SCHEMA IN (${schemaNames.map(() => '?').join(',')})
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
				WHERE TABLE_SCHEMA IN (${schemaNames.map(() => '?').join(',')})
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
				WHERE kcu.TABLE_SCHEMA IN (${schemaNames.map(() => '?').join(',')})
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
				WHERE kcu.REFERENCED_TABLE_SCHEMA IN (${schemaNames.map(() => '?').join(',')})
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				GROUP BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
					kcu.CONSTRAINT_NAME, kcu.TABLE_SCHEMA, kcu.TABLE_NAME
				ORDER BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.CONSTRAINT_NAME`,
				schemaNames,
			),
		])

		// Group columns by schema.table
		const columns: SchemaData['columns'] = {}
		for (const row of allColumns as MysqlColumnRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!columns[key]) columns[key] = []
			columns[key].push({
				name: row.column_name,
				dataType: mapMysqlDataType(row.data_type),
				nullable: row.is_nullable === 'YES',
				defaultValue: row.column_default,
				isPrimaryKey: row.column_key === 'PRI',
				isAutoIncrement: (row.extra ?? '').includes('auto_increment'),
				maxLength: row.character_maximum_length ?? undefined,
			})
		}

		// Group indexes by schema.table
		const indexes: SchemaData['indexes'] = {}
		for (const row of allIndexes as MysqlIndexRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!indexes[key]) indexes[key] = []
			indexes[key].push({
				name: row.index_name,
				columns: typeof row.columns === 'string' ? row.columns.split(',') : [row.columns],
				isUnique: row.non_unique === 0 || row.non_unique === '0',
				isPrimary: row.index_name === 'PRIMARY',
			})
		}

		// Group foreign keys by schema.table
		const foreignKeys: SchemaData['foreignKeys'] = {}
		for (const row of allForeignKeys as MysqlForeignKeyRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!foreignKeys[key]) foreignKeys[key] = []
			foreignKeys[key].push({
				name: row.constraint_name,
				columns: typeof row.columns === 'string' ? row.columns.split(',') : [row.columns],
				referencedSchema: row.referenced_schema,
				referencedTable: row.referenced_table,
				referencedColumns: typeof row.referenced_columns === 'string'
					? row.referenced_columns.split(',')
					: [row.referenced_columns],
				onUpdate: row.on_update,
				onDelete: row.on_delete,
			})
		}

		// Group referencing foreign keys by schema.table (the referenced table)
		const referencingForeignKeys: SchemaData['referencingForeignKeys'] = {}
		for (const row of allReferencingForeignKeys as MysqlReferencingFkRow[]) {
			const key = `${row.referenced_schema}.${row.referenced_table}`
			if (!referencingForeignKeys[key]) referencingForeignKeys[key] = []
			referencingForeignKeys[key].push({
				constraintName: row.constraint_name,
				referencingSchema: row.referencing_schema,
				referencingTable: row.referencing_table,
				referencingColumns: typeof row.referencing_columns === 'string'
					? row.referencing_columns.split(',')
					: [row.referencing_columns],
				referencedColumns: typeof row.referenced_columns === 'string'
					? row.referenced_columns.split(',')
					: [row.referenced_columns],
			})
		}

		// Ensure every table has entries (even if empty)
		for (const schema of schemas) {
			for (const table of tables[schema.name]) {
				const key = `${schema.name}.${table.name}`
				if (!columns[key]) columns[key] = []
				if (!indexes[key]) indexes[key] = []
				if (!foreignKeys[key]) foreignKeys[key] = []
				if (!referencingForeignKeys[key]) referencingForeignKeys[key] = []
			}
		}

		return { schemas, tables, columns, indexes, foreignKeys, referencingForeignKeys }
	}

	private async getSchemas(conn: SQL | ReservedSQL): Promise<SchemaInfo[]> {
		this.ensureConnected()
		const rows = await conn.unsafe('SELECT DATABASE() AS name')
		return [...rows] as SchemaInfo[]
	}

	private async getTables(conn: SQL | ReservedSQL, schema: string): Promise<TableInfo[]> {
		this.ensureConnected()
		const rows = await conn.unsafe(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = ?
			ORDER BY table_name`,
			[schema],
		)
		return [...rows].map((row: MysqlTableRow) => ({
			schema,
			name: row.name,
			type: row.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
		}))
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
		const session = this.resolveSession(sessionId)
		if (session?.txActive) throw new Error('Cannot iterate on a session with an active transaction')
		const conn = session ? session.conn : await this.db!.reserve()
		const ownConn = !session
		if (session) {
			session.txActive = true
			session.iterating = true
		}
		try {
			await conn.unsafe('START TRANSACTION WITH CONSISTENT SNAPSHOT')
			let offset = 0
			while (true) {
				if (signal?.aborted) {
					throw new DOMException('Aborted', 'AbortError')
				}
				const pagedSql = `${sql} LIMIT ? OFFSET ?`
				const result = await conn.unsafe(pagedSql, [...(params ?? []), batchSize, offset])
				const rows = [...result] as Record<string, unknown>[]
				if (rows.length === 0) break
				yield rows
				if (rows.length < batchSize) break
				offset += batchSize
			}
			await conn.unsafe('COMMIT')
		} catch (err) {
			try {
				await conn.unsafe('ROLLBACK')
			} catch { /* ignore */ }
			throw err
		} finally {
			if (session) {
				session.txActive = false
				session.iterating = false
			}
			if (ownConn) {
				await this.resetConnection(conn as ReservedSQL)
				;(conn as ReservedSQL).release()
			}
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
		if (sessionId) {
			const session = this.sessions.get(sessionId)
			if (!session) throw new Error(`Session "${sessionId}" not found`)
			await session.conn.unsafe('START TRANSACTION')
			session.txActive = true
		} else {
			// Backward compat: reserve into __default__ session
			if (this.sessions.has(DEFAULT_SESSION)) {
				throw new Error('A default transaction is already active. Commit or rollback before starting a new one.')
			}
			const conn = await this.db!.reserve()
			try {
				await conn.unsafe('START TRANSACTION')
			} catch (err) {
				conn.release()
				throw err
			}
			this.sessions.set(DEFAULT_SESSION, { conn, txActive: true, iterating: false, activeQueries: new Set() })
		}
	}

	async commit(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		if (session.iterating) throw new Error('Cannot commit during active iteration')
		try {
			await session.conn.unsafe('COMMIT')
			session.txActive = false
		} catch (err) {
			if (isConnectionLevelError(err)) {
				session.txActive = false
				throw new DatabaseError(
					'COMMIT_UNCERTAIN',
					'Connection lost during COMMIT — the transaction may have been committed. Verify your data before retrying.',
					{ cause: err },
				)
			}
			try {
				await session.conn.unsafe('ROLLBACK')
				session.txActive = false
			} catch { /* ROLLBACK failed — leave txActive true so session is known-dirty */ }
			throw err
		} finally {
			if (id === DEFAULT_SESSION) {
				try {
					await this.resetConnection(session.conn)
				} catch { /* connection may be broken */ }
				try {
					session.conn.release()
				} catch { /* connection may be broken */ }
				this.sessions.delete(DEFAULT_SESSION)
			}
		}
	}

	async rollback(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		if (session.iterating) throw new Error('Cannot rollback during active iteration')
		try {
			await session.conn.unsafe('ROLLBACK')
			session.txActive = false
		} catch (err) {
			if (isConnectionLevelError(err)) {
				session.txActive = false
			}
			throw err
		} finally {
			if (id === DEFAULT_SESSION) {
				try {
					await this.resetConnection(session.conn)
				} catch { /* connection may be broken */ }
				try {
					session.conn.release()
				} catch { /* connection may be broken */ }
				this.sessions.delete(DEFAULT_SESSION)
			}
		}
	}

	inTransaction(sessionId?: string): boolean {
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		return session?.txActive ?? false
	}

	isIterating(sessionId?: string): boolean {
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		return session?.iterating ?? false
	}

	getDriverType(): 'mysql' {
		return 'mysql'
	}

	quoteIdentifier(name: string): string {
		return `\`${name.replace(/`/g, '``')}\``
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} () VALUES ()`
	}

	placeholder(_index: number): string {
		return '?'
	}

	/** Reset all session state on a connection before returning it to the pool. */
	private async resetConnection(conn: ReservedSQL): Promise<void> {
		try {
			await conn.unsafe('RESET CONNECTION')
		} catch {
			// Fallback for older MySQL versions without RESET CONNECTION.
			// RESET CONNECTION would also clear user variables, session variables,
			// prepared statements, and temp tables — best-effort approximation:
			const fallbacks = [
				'ROLLBACK',
				'UNLOCK TABLES',
				`SET SESSION TRANSACTION ISOLATION LEVEL ${this.defaultIsolationLevel}`,
				'SET NAMES utf8mb4',
			]
			for (const sql of fallbacks) {
				try {
					await conn.unsafe(sql)
				} catch { /* best effort */ }
			}
		}
	}

	private ensureConnected(): void {
		if (!this.db || !this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}

	private resolveSession(sessionId?: string): SessionState | undefined {
		if (!sessionId) {
			// Check for __default__ session (backward compat for tx without sessionId)
			return this.sessions.get(DEFAULT_SESSION)
		}
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Session "${sessionId}" not found`)
		return session
	}
}
