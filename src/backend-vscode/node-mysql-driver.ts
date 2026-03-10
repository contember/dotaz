import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { SchemaData, SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import mysql from 'mysql2/promise'
import type { FieldPacket, OkPacket, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { mapMysqlError } from '@dotaz/backend-shared/db/error-mapping'

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

interface SessionState {
	conn: mysql.PoolConnection
	threadId: number
	txActive: boolean
}

/** Internal session ID used for backward-compatible beginTransaction() without sessionId */
const DEFAULT_SESSION = '__default__'

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

export class NodeMysqlDriver implements DatabaseDriver {
	private pool: mysql.Pool | null = null
	private connected = false
	private sessions = new Map<string, SessionState>()

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'mysql') {
			throw new Error('NodeMysqlDriver requires a mysql connection config')
		}
		this.pool = mysql.createPool({
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
			ssl: config.ssl ? {} : undefined,
			connectionLimit: 10,
		})
		// Verify the connection works
		try {
			const conn = await this.pool.getConnection()
			conn.release()
		} catch (err) {
			await this.pool.end()
			this.pool = null
			throw err instanceof DatabaseError ? err : mapMysqlError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		// Release all sessions
		for (const [, session] of this.sessions) {
			if (session.txActive) {
				try {
					await session.conn.query('ROLLBACK')
				} catch { /* ignore */ }
			}
			session.conn.release()
		}
		this.sessions.clear()

		if (this.pool) {
			await this.pool.end()
			this.pool = null
			this.connected = false
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
		const conn = await this.pool!.getConnection()
		const [rows] = await conn.query('SELECT CONNECTION_ID() AS id')
		const threadId = (rows as RowDataPacket[])[0].id as number
		this.sessions.set(sessionId, { conn, threadId, txActive: false })
	}

	async releaseSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session "${sessionId}" not found`)
		}
		if (session.txActive) {
			try {
				await session.conn.query('ROLLBACK')
			} catch { /* ignore */ }
		}
		session.conn.release()
		this.sessions.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessions.keys()].filter((id) => id !== DEFAULT_SESSION)
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.pool!
		const start = performance.now()
		try {
			type MysqlResult = [RowDataPacket[] | ResultSetHeader | OkPacket, FieldPacket[]]
			let result: MysqlResult
			if (params && params.length > 0) {
				result = await (conn as mysql.PoolConnection).execute(sql, params as any[]) as MysqlResult
			} else {
				result = await (conn as mysql.PoolConnection).query(sql) as MysqlResult
			}
			const durationMs = Math.round(performance.now() - start)
			const [data, fields] = result

			// DML statements (INSERT/UPDATE/DELETE) return a ResultSetHeader, not rows
			if (!Array.isArray(data)) {
				const header = data as ResultSetHeader
				return {
					columns: [],
					rows: [],
					rowCount: 0,
					affectedRows: header.affectedRows ?? 0,
					durationMs,
				}
			}

			const rows = data as Record<string, unknown>[]

			const columns: QueryResultColumn[] = fields && fields.length > 0
				? fields.map((f) => ({
					name: f.name,
					dataType: DatabaseDataType.Unknown,
				}))
				: rows.length > 0
					? Object.keys(rows[0]).map((name) => ({
						name,
						dataType: DatabaseDataType.Unknown,
					}))
					: []

			return {
				columns,
				rows,
				rowCount: rows.length,
				affectedRows: 0,
				durationMs,
			}
		} catch (err) {
			throw err instanceof DatabaseError ? err : mapMysqlError(err)
		}
	}

	async cancel(sessionId?: string): Promise<void> {
		if (!this.pool) return
		const session = sessionId ? this.sessions.get(sessionId) : this.sessions.get(DEFAULT_SESSION)
		if (session) {
			try {
				await this.pool.query(`KILL QUERY ${session.threadId}`)
			} catch { /* ignore */ }
		}
	}

	async loadSchema(sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.pool!

		const schemas = await this.getSchemas(conn)
		const schemaNames = schemas.map((s) => s.name)

		const tables: SchemaData['tables'] = {}
		for (const schema of schemas) {
			tables[schema.name] = await this.getTables(conn, schema.name)
		}

		const placeholders = schemaNames.map(() => '?').join(',')

		const [allColumns, allIndexes, allForeignKeys, allReferencingForeignKeys] = await Promise.all([
			// All columns
			conn.query(
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
				WHERE c.TABLE_SCHEMA IN (${placeholders})
				ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
				schemaNames,
			),
			// All indexes
			conn.query(
				`SELECT
					TABLE_SCHEMA AS table_schema,
					TABLE_NAME AS table_name,
					INDEX_NAME AS index_name,
					NON_UNIQUE AS non_unique,
					GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS \`columns\`
				FROM information_schema.STATISTICS
				WHERE TABLE_SCHEMA IN (${placeholders})
				GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE
				ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME`,
				schemaNames,
			),
			// All foreign keys
			conn.query(
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
				WHERE kcu.TABLE_SCHEMA IN (${placeholders})
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				GROUP BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME,
					kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
					rc.UPDATE_RULE, rc.DELETE_RULE
				ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME`,
				schemaNames,
			),
			// All referencing foreign keys
			conn.query(
				`SELECT
					kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
					kcu.REFERENCED_TABLE_NAME AS referenced_table,
					kcu.CONSTRAINT_NAME AS constraint_name,
					kcu.TABLE_SCHEMA AS referencing_schema,
					kcu.TABLE_NAME AS referencing_table,
					GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS referencing_columns,
					GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS referenced_columns
				FROM information_schema.KEY_COLUMN_USAGE kcu
				WHERE kcu.REFERENCED_TABLE_SCHEMA IN (${placeholders})
					AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
				GROUP BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
					kcu.CONSTRAINT_NAME, kcu.TABLE_SCHEMA, kcu.TABLE_NAME
				ORDER BY kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.CONSTRAINT_NAME`,
				schemaNames,
			),
		])

		// Group columns by schema.table
		const columns: SchemaData['columns'] = {}
		for (const row of (allColumns as [RowDataPacket[], FieldPacket[]])[0] as unknown as MysqlColumnRow[]) {
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
		for (const row of (allIndexes as [RowDataPacket[], FieldPacket[]])[0] as unknown as MysqlIndexRow[]) {
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
		for (const row of (allForeignKeys as [RowDataPacket[], FieldPacket[]])[0] as unknown as MysqlForeignKeyRow[]) {
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
		for (const row of (allReferencingForeignKeys as [RowDataPacket[], FieldPacket[]])[0] as unknown as MysqlReferencingFkRow[]) {
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

	private async getSchemas(conn: mysql.Pool | mysql.PoolConnection): Promise<SchemaInfo[]> {
		const [rows] = await conn.query('SELECT DATABASE() AS name')
		return (rows as RowDataPacket[]) as unknown as SchemaInfo[]
	}

	private async getTables(conn: mysql.Pool | mysql.PoolConnection, schema: string): Promise<TableInfo[]> {
		const [rows] = await conn.query(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = ?
			ORDER BY table_name`,
			[schema],
		)
		return (rows as RowDataPacket[]).map((row: any) => ({
			schema,
			name: row.name,
			type: row.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
		}))
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
		const conn = session ? session.conn : this.pool!
		let offset = 0
		while (true) {
			if (signal?.aborted) {
				throw new DOMException('Aborted', 'AbortError')
			}
			const pagedSql = `${sql} LIMIT ? OFFSET ?`
			const [rows] = await (conn as mysql.PoolConnection).execute(pagedSql, [...(params ?? []), batchSize, offset] as any[]) as [RowDataPacket[], FieldPacket[]]
			const batch = rows as Record<string, unknown>[]
			if (batch.length === 0) break
			yield batch
			if (batch.length < batchSize) break
			offset += batchSize
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
			await session.conn.query('START TRANSACTION')
			session.txActive = true
		} else {
			// Backward compat: reserve into __default__ session
			const conn = await this.pool!.getConnection()
			try {
				const [rows] = await conn.query('SELECT CONNECTION_ID() AS id')
				const threadId = (rows as RowDataPacket[])[0].id as number
				await conn.query('START TRANSACTION')
				this.sessions.set(DEFAULT_SESSION, { conn, threadId, txActive: true })
			} catch (err) {
				conn.release()
				throw err
			}
		}
	}

	async commit(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		await session.conn.query('COMMIT')
		session.txActive = false
		// If __default__ session, release it after commit
		if (id === DEFAULT_SESSION) {
			session.conn.release()
			this.sessions.delete(DEFAULT_SESSION)
		}
	}

	async rollback(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		await session.conn.query('ROLLBACK')
		session.txActive = false
		// If __default__ session, release it after rollback
		if (id === DEFAULT_SESSION) {
			session.conn.release()
			this.sessions.delete(DEFAULT_SESSION)
		}
	}

	inTransaction(sessionId?: string): boolean {
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		return session?.txActive ?? false
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

	private ensureConnected(): void {
		if (!this.pool || !this.connected) {
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
