import { SQL } from 'bun'
import type { ReservedSQL } from 'bun'
import type { ConnectionConfig } from '../../shared/types/connection'
import { DatabaseDataType } from '../../shared/types/database'
import type { SchemaData, SchemaInfo, TableInfo } from '../../shared/types/database'
import { DatabaseError } from '../../shared/types/errors'
import type { QueryResult, QueryResultColumn } from '../../shared/types/query'
import type { DatabaseDriver } from '../db/driver'
import { mapPostgresError } from '../db/error-mapping'
import { getAffectedRowCount } from '../db/result-utils'

/** Row shape from information_schema.columns joined with PK info */
interface PgColumnRow {
	table_schema: string
	table_name: string
	column_name: string
	data_type: string
	udt_name: string
	is_nullable: string
	column_default: string | null
	character_maximum_length: number | null
	is_primary_key: boolean
}

/** Row shape from pg_catalog index query */
interface PgIndexRow {
	table_schema: string
	table_name: string
	index_name: string
	is_unique: boolean
	is_primary: boolean
	columns: string[] | string
}

/** Row shape from pg_catalog foreign key query */
interface PgForeignKeyRow {
	table_schema: string
	table_name: string
	constraint_name: string
	columns: string[] | string
	referenced_schema: string
	referenced_table: string
	referenced_columns: string[] | string
	on_update: string
	on_delete: string
}

/** Row shape from pg_catalog referencing foreign key query */
interface PgReferencingFkRow {
	referenced_schema: string
	referenced_table: string
	constraint_name: string
	referencing_schema: string
	referencing_table: string
	referencing_columns: string[] | string
	referenced_columns: string[] | string
}

/** Row shape from information_schema.tables */
interface PgTableRow {
	name: string
	table_type: string
}

interface SessionState {
	conn: ReservedSQL
	txActive: boolean
	activeQuery: ReturnType<SQL['unsafe']> | null
}

/** Internal session ID used for backward-compatible beginTransaction() without sessionId */
const DEFAULT_SESSION = '__default__'

/** Map PostgreSQL information_schema data_type to DatabaseDataType. */
function mapPgDataType(dataType: string): DatabaseDataType {
	switch (dataType.toLowerCase()) {
		case 'integer':
		case 'bigint':
		case 'smallint':
			return DatabaseDataType.Integer
		case 'serial':
		case 'bigserial':
		case 'smallserial':
			return DatabaseDataType.Serial
		case 'real':
		case 'double precision':
			return DatabaseDataType.Float
		case 'numeric':
		case 'decimal':
		case 'money':
			return DatabaseDataType.Numeric
		case 'boolean':
			return DatabaseDataType.Boolean
		case 'text':
			return DatabaseDataType.Text
		case 'character varying':
			return DatabaseDataType.Varchar
		case 'character':
			return DatabaseDataType.Char
		case 'date':
			return DatabaseDataType.Date
		case 'time without time zone':
		case 'time with time zone':
			return DatabaseDataType.Time
		case 'timestamp without time zone':
		case 'timestamp with time zone':
			return DatabaseDataType.Timestamp
		case 'json':
		case 'jsonb':
			return DatabaseDataType.Json
		case 'uuid':
			return DatabaseDataType.Uuid
		case 'bytea':
		case 'bit':
		case 'bit varying':
			return DatabaseDataType.Binary
		default:
			return DatabaseDataType.Unknown
	}
}

export class PostgresDriver implements DatabaseDriver {
	private db: SQL | null = null
	private connected = false
	private sessions = new Map<string, SessionState>()
	private poolActiveQuery: ReturnType<SQL['unsafe']> | null = null

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'postgresql') {
			throw new Error(
				'PostgresDriver requires a postgresql connection config',
			)
		}
		const sslParam = config.ssl ? `?sslmode=${config.ssl}` : ''
		const url = `postgres://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${
			encodeURIComponent(config.database)
		}${sslParam}`
		this.db = new SQL({ url })
		// Verify the connection works
		try {
			await this.db`SELECT 1`
		} catch (err) {
			this.db = null
			throw err instanceof DatabaseError ? err : mapPostgresError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		// Release all sessions
		for (const [, session] of this.sessions) {
			if (session.txActive) {
				try {
					await session.conn.unsafe('ROLLBACK')
				} catch { /* ignore */ }
			}
			session.conn.release()
		}
		this.sessions.clear()

		if (this.db) {
			await this.db.close()
			this.db = null
			this.connected = false
		}
	}

	isConnected(): boolean {
		return this.connected
	}

	// --- Session management ---

	async reserveSession(sessionId: string): Promise<void> {
		this.ensureConnected()
		if (this.sessions.has(sessionId)) {
			throw new Error(`Session "${sessionId}" already exists`)
		}
		const conn = await this.db!.reserve()
		this.sessions.set(sessionId, { conn, txActive: false, activeQuery: null })
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
		session.conn.release()
		this.sessions.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessions.keys()].filter((id) => id !== DEFAULT_SESSION)
	}

	// --- Query execution ---

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.db!
		const start = performance.now()
		const query = conn.unsafe(sql, params ?? [])
		if (session) {
			session.activeQuery = query
		} else {
			this.poolActiveQuery = query
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
			throw err instanceof DatabaseError ? err : mapPostgresError(err)
		} finally {
			if (session) {
				session.activeQuery = null
			} else {
				this.poolActiveQuery = null
			}
		}
	}

	async cancel(sessionId?: string): Promise<void> {
		if (sessionId) {
			const session = this.sessions.get(sessionId)
			if (session?.activeQuery) {
				session.activeQuery.cancel()
				session.activeQuery = null
			}
		} else {
			if (this.poolActiveQuery) {
				this.poolActiveQuery.cancel()
				this.poolActiveQuery = null
			}
		}
	}

	async loadSchema(sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const conn = session ? session.conn : this.db!

		const schemas = await this.getSchemas(conn)
		const schemaNames = schemas.map((s) => s.name)
		// Format as PG array literal for use with ANY($1)
		const pgArray = `{${schemaNames.join(',')}}`

		const tables: SchemaData['tables'] = {}
		for (const schema of schemas) {
			tables[schema.name] = await this.getTables(conn, schema.name)
		}

		const [allColumns, allIndexes, allForeignKeys, allReferencingForeignKeys] = await Promise.all([
			// All columns across all schemas
			conn.unsafe(
				`SELECT
					c.table_schema,
					c.table_name,
					c.column_name,
					c.data_type,
					c.udt_name,
					c.is_nullable,
					c.column_default,
					c.character_maximum_length,
					CASE
						WHEN pk.column_name IS NOT NULL THEN true
						ELSE false
					END AS is_primary_key
				FROM information_schema.columns c
				LEFT JOIN (
					SELECT kcu.table_schema, kcu.table_name, kcu.column_name
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage kcu
						ON tc.constraint_name = kcu.constraint_name
						AND tc.table_schema = kcu.table_schema
					WHERE tc.constraint_type = 'PRIMARY KEY'
						AND tc.table_schema = ANY($1)
				) pk ON pk.table_schema = c.table_schema
					AND pk.table_name = c.table_name
					AND pk.column_name = c.column_name
				WHERE c.table_schema = ANY($1)
				ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
				[pgArray],
			),
			// All indexes across all schemas
			conn.unsafe(
				`SELECT
					n.nspname AS table_schema,
					t.relname AS table_name,
					i.relname AS index_name,
					ix.indisunique AS is_unique,
					ix.indisprimary AS is_primary,
					array_agg(a.attname ORDER BY k.n) AS columns
				FROM pg_catalog.pg_index ix
				JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
				JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
				JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
				CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
				JOIN pg_catalog.pg_attribute a
					ON a.attrelid = t.oid AND a.attnum = k.attnum
				WHERE n.nspname = ANY($1)
				GROUP BY n.nspname, t.relname, i.relname, ix.indisunique, ix.indisprimary
				ORDER BY n.nspname, t.relname, i.relname`,
				[pgArray],
			),
			// All foreign keys across all schemas
			conn.unsafe(
				`SELECT
					nsp_src.nspname AS table_schema,
					cl_src.relname AS table_name,
					con.conname AS constraint_name,
					array_agg(att_src.attname ORDER BY u.pos) AS columns,
					nsp_ref.nspname AS referenced_schema,
					cl_ref.relname AS referenced_table,
					array_agg(att_ref.attname ORDER BY u.pos) AS referenced_columns,
					CASE con.confupdtype
						WHEN 'a' THEN 'NO ACTION'
						WHEN 'r' THEN 'RESTRICT'
						WHEN 'c' THEN 'CASCADE'
						WHEN 'n' THEN 'SET NULL'
						WHEN 'd' THEN 'SET DEFAULT'
					END AS on_update,
					CASE con.confdeltype
						WHEN 'a' THEN 'NO ACTION'
						WHEN 'r' THEN 'RESTRICT'
						WHEN 'c' THEN 'CASCADE'
						WHEN 'n' THEN 'SET NULL'
						WHEN 'd' THEN 'SET DEFAULT'
					END AS on_delete
				FROM pg_catalog.pg_constraint con
				JOIN pg_catalog.pg_class cl_src ON cl_src.oid = con.conrelid
				JOIN pg_catalog.pg_namespace nsp_src ON nsp_src.oid = cl_src.relnamespace
				JOIN pg_catalog.pg_class cl_ref ON cl_ref.oid = con.confrelid
				JOIN pg_catalog.pg_namespace nsp_ref ON nsp_ref.oid = cl_ref.relnamespace
				CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(src_attnum, ref_attnum, pos)
				JOIN pg_catalog.pg_attribute att_src
					ON att_src.attrelid = con.conrelid AND att_src.attnum = u.src_attnum
				JOIN pg_catalog.pg_attribute att_ref
					ON att_ref.attrelid = con.confrelid AND att_ref.attnum = u.ref_attnum
				WHERE con.contype = 'f'
					AND nsp_src.nspname = ANY($1)
				GROUP BY nsp_src.nspname, cl_src.relname, con.conname,
					nsp_ref.nspname, cl_ref.relname, con.confupdtype, con.confdeltype
				ORDER BY nsp_src.nspname, cl_src.relname, con.conname`,
				[pgArray],
			),
			// All referencing foreign keys across all schemas
			conn.unsafe(
				`SELECT
					nsp_ref.nspname AS referenced_schema,
					cl_ref.relname AS referenced_table,
					con.conname AS constraint_name,
					nsp_src.nspname AS referencing_schema,
					cl_src.relname AS referencing_table,
					array_agg(att_src.attname ORDER BY u.pos) AS referencing_columns,
					array_agg(att_ref.attname ORDER BY u.pos) AS referenced_columns
				FROM pg_catalog.pg_constraint con
				JOIN pg_catalog.pg_class cl_src ON cl_src.oid = con.conrelid
				JOIN pg_catalog.pg_namespace nsp_src ON nsp_src.oid = cl_src.relnamespace
				JOIN pg_catalog.pg_class cl_ref ON cl_ref.oid = con.confrelid
				JOIN pg_catalog.pg_namespace nsp_ref ON nsp_ref.oid = cl_ref.relnamespace
				CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(src_attnum, ref_attnum, pos)
				JOIN pg_catalog.pg_attribute att_src
					ON att_src.attrelid = con.conrelid AND att_src.attnum = u.src_attnum
				JOIN pg_catalog.pg_attribute att_ref
					ON att_ref.attrelid = con.confrelid AND att_ref.attnum = u.ref_attnum
				WHERE con.contype = 'f'
					AND nsp_ref.nspname = ANY($1)
				GROUP BY nsp_ref.nspname, cl_ref.relname, con.conname,
					nsp_src.nspname, cl_src.relname
				ORDER BY nsp_ref.nspname, cl_ref.relname, con.conname`,
				[pgArray],
			),
		])

		// Group columns by schema.table
		const columns: SchemaData['columns'] = {}
		for (const row of allColumns as PgColumnRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!columns[key]) columns[key] = []
			columns[key].push({
				name: row.column_name,
				dataType: this.mapDataType(row.data_type, row.udt_name),
				nullable: row.is_nullable === 'YES',
				defaultValue: row.column_default,
				isPrimaryKey: row.is_primary_key,
				isAutoIncrement: row.is_primary_key
					&& typeof row.column_default === 'string'
					&& row.column_default.startsWith('nextval('),
				maxLength: row.character_maximum_length ?? undefined,
			})
		}

		// Group indexes by schema.table
		const indexes: SchemaData['indexes'] = {}
		for (const row of allIndexes as PgIndexRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!indexes[key]) indexes[key] = []
			indexes[key].push({
				name: row.index_name,
				columns: typeof row.columns === 'string'
					? row.columns.replace(/^\{|\}$/g, '').split(',')
					: row.columns,
				isUnique: row.is_unique,
				isPrimary: row.is_primary,
			})
		}

		// Group foreign keys by schema.table
		const foreignKeys: SchemaData['foreignKeys'] = {}
		for (const row of allForeignKeys as PgForeignKeyRow[]) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!foreignKeys[key]) foreignKeys[key] = []
			foreignKeys[key].push({
				name: row.constraint_name,
				columns: typeof row.columns === 'string'
					? row.columns.replace(/^\{|\}$/g, '').split(',')
					: row.columns,
				referencedSchema: row.referenced_schema,
				referencedTable: row.referenced_table,
				referencedColumns: typeof row.referenced_columns === 'string'
					? row.referenced_columns.replace(/^\{|\}$/g, '').split(',')
					: row.referenced_columns,
				onUpdate: row.on_update,
				onDelete: row.on_delete,
			})
		}

		// Group referencing foreign keys by schema.table (the referenced table)
		const referencingForeignKeys: SchemaData['referencingForeignKeys'] = {}
		for (const row of allReferencingForeignKeys as PgReferencingFkRow[]) {
			const key = `${row.referenced_schema}.${row.referenced_table}`
			if (!referencingForeignKeys[key]) referencingForeignKeys[key] = []
			referencingForeignKeys[key].push({
				constraintName: row.constraint_name,
				referencingSchema: row.referencing_schema,
				referencingTable: row.referencing_table,
				referencingColumns: typeof row.referencing_columns === 'string'
					? row.referencing_columns.replace(/^\{|\}$/g, '').split(',')
					: row.referencing_columns,
				referencedColumns: typeof row.referenced_columns === 'string'
					? row.referenced_columns.replace(/^\{|\}$/g, '').split(',')
					: row.referenced_columns,
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
		const rows = await conn.unsafe(
			`SELECT schema_name AS name
			FROM information_schema.schemata
			WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
			ORDER BY schema_name`,
		)
		return [...rows] as SchemaInfo[]
	}

	private async getTables(conn: SQL | ReservedSQL, schema: string): Promise<TableInfo[]> {
		this.ensureConnected()
		const rows = await conn.unsafe(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = $1
			ORDER BY table_name`,
			[schema],
		)
		return [...rows].map((row: PgTableRow) => ({
			schema,
			name: row.name,
			type: row.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
		}))
	}

	// --- Transactions ---

	async beginTransaction(sessionId?: string): Promise<void> {
		this.ensureConnected()
		if (sessionId) {
			const session = this.sessions.get(sessionId)
			if (!session) throw new Error(`Session "${sessionId}" not found`)
			await session.conn.unsafe('BEGIN')
			session.txActive = true
		} else {
			// Backward compat: reserve into __default__ session
			const conn = await this.db!.reserve()
			try {
				await conn.unsafe('BEGIN')
			} catch (err) {
				conn.release()
				throw err
			}
			this.sessions.set(DEFAULT_SESSION, { conn, txActive: true, activeQuery: null })
		}
	}

	async commit(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		await session.conn.unsafe('COMMIT')
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
		await session.conn.unsafe('ROLLBACK')
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

	getDriverType(): 'postgresql' {
		return 'postgresql'
	}

	quoteIdentifier(name: string): string {
		return `"${name.replace(/"/g, '""')}"`
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`
	}

	placeholder(index: number): string {
		return `$${index}`
	}

	async *iterate(
		sql: string,
		params?: unknown[],
		batchSize = 1000,
		signal?: AbortSignal,
		sessionId?: string,
	): AsyncGenerator<Record<string, unknown>[]> {
		this.ensureConnected()
		const cursorId = `dotaz_iter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

		// If sessionId provided, use that session's conn (no separate reserve)
		const session = sessionId ? this.sessions.get(sessionId) : undefined
		if (sessionId && !session) throw new Error(`Session "${sessionId}" not found`)

		const conn = session ? session.conn : await this.db!.reserve()
		const ownConn = !session // we own the connection if not using a session
		try {
			await conn.unsafe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
			await conn.unsafe(
				`DECLARE ${cursorId} NO SCROLL CURSOR FOR ${sql}`,
				params ?? [],
			)
			try {
				while (true) {
					if (signal?.aborted) {
						throw new DOMException('Aborted', 'AbortError')
					}
					const result = await conn.unsafe(
						`FETCH FORWARD ${batchSize} FROM ${cursorId}`,
					)
					const rows = [...result] as Record<string, unknown>[]
					if (rows.length === 0) break
					yield rows
					if (rows.length < batchSize) break
				}
			} finally {
				await conn.unsafe(`CLOSE ${cursorId}`)
			}
			await conn.unsafe('COMMIT')
		} catch (err) {
			try {
				await conn.unsafe('ROLLBACK')
			} catch { /* ignore rollback errors */ }
			throw err
		} finally {
			if (ownConn) {
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

	private mapDataType(dataType: string, udtName: string): DatabaseDataType {
		if (dataType === 'ARRAY') return DatabaseDataType.Array
		if (dataType === 'USER-DEFINED') {
			// udtName for known types like jsonb, hstore
			const u = udtName.toLowerCase()
			if (u === 'json' || u === 'jsonb') return DatabaseDataType.Json
			return DatabaseDataType.Enum
		}
		return mapPgDataType(dataType)
	}
}
