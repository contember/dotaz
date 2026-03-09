import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { SchemaData, SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import pg from 'pg'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { mapPostgresError } from '@dotaz/backend-shared/db/error-mapping'

interface SessionState {
	client: pg.PoolClient
	txActive: boolean
	pid: number
}

const DEFAULT_SESSION = '__default__'

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

export class NodePostgresDriver implements DatabaseDriver {
	private pool: pg.Pool | null = null
	private connected = false
	private sessions = new Map<string, SessionState>()

	async connect(config: ConnectionConfig): Promise<void> {
		if (config.type !== 'postgresql') {
			throw new Error('NodePostgresDriver requires a postgresql connection config')
		}
		const ssl = config.ssl && config.ssl !== 'disable'
			? config.ssl === 'require'
				? { rejectUnauthorized: false }
				: true
			: false
		this.pool = new pg.Pool({
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
			ssl,
			max: 10,
		})
		try {
			const client = await this.pool.connect()
			client.release()
		} catch (err) {
			await this.pool.end()
			this.pool = null
			throw err instanceof DatabaseError ? err : mapPostgresError(err)
		}
		this.connected = true
	}

	async disconnect(): Promise<void> {
		for (const [, session] of this.sessions) {
			if (session.txActive) {
				try {
					await session.client.query('ROLLBACK')
				} catch { /* ignore */ }
			}
			session.client.release()
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
		const client = await this.pool!.connect()
		const pidResult = await client.query('SELECT pg_backend_pid() as pid')
		const pid = pidResult.rows[0].pid as number
		this.sessions.set(sessionId, { client, txActive: false, pid })
	}

	async releaseSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session "${sessionId}" not found`)
		}
		if (session.txActive) {
			try {
				await session.client.query('ROLLBACK')
			} catch { /* ignore */ }
		}
		session.client.release()
		this.sessions.delete(sessionId)
	}

	getSessionIds(): string[] {
		return [...this.sessions.keys()].filter((id) => id !== DEFAULT_SESSION)
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const queryable = session ? session.client : this.pool!
		const start = performance.now()
		try {
			const result = await queryable.query(sql, params)
			const durationMs = Math.round(performance.now() - start)
			const rows = result.rows as Record<string, unknown>[]
			const columns: QueryResultColumn[] = result.fields
				? result.fields.map((f: pg.FieldDef) => ({ name: f.name, dataType: DatabaseDataType.Unknown }))
				: rows.length > 0
					? Object.keys(rows[0]).map((name) => ({ name, dataType: DatabaseDataType.Unknown }))
					: []
			return {
				columns,
				rows,
				rowCount: rows.length,
				affectedRows: result.rowCount ?? 0,
				durationMs,
			}
		} catch (err) {
			throw err instanceof DatabaseError ? err : mapPostgresError(err)
		}
	}

	async cancel(sessionId?: string): Promise<void> {
		if (!this.pool) return
		const session = sessionId ? this.sessions.get(sessionId) : this.sessions.get(DEFAULT_SESSION)
		if (session) {
			try {
				await this.pool.query('SELECT pg_cancel_backend($1)', [session.pid])
			} catch { /* ignore */ }
		}
	}

	async loadSchema(sessionId?: string): Promise<SchemaData> {
		this.ensureConnected()
		const session = this.resolveSession(sessionId)
		const queryable = session ? session.client : this.pool!

		const schemas = await this.getSchemas(queryable)
		const schemaNames = schemas.map((s) => s.name)
		const pgArray = `{${schemaNames.join(',')}}`

		const tables: SchemaData['tables'] = {}
		for (const schema of schemas) {
			const regularTables = await this.getTablesForSchema(queryable, schema.name)
			const matviews = await this.getMaterializedViews(queryable, schema.name)
			tables[schema.name] = [...regularTables, ...matviews]
		}

		const matviewNames = new Map<string, string[]>()
		for (const schema of schemas) {
			const mvs = tables[schema.name].filter((t) => t.type === 'materialized-view')
			if (mvs.length > 0) {
				matviewNames.set(schema.name, mvs.map((t) => t.name))
			}
		}

		const [allColumns, allIndexes, allForeignKeys, allReferencingForeignKeys] = await Promise.all([
			queryable.query(
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
			queryable.query(
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
			queryable.query(
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
			queryable.query(
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

		// Fetch materialized view columns from pg_attribute
		for (const [schemaName, mvNames] of matviewNames) {
			const mvResult = await queryable.query(
				`SELECT
					n.nspname AS schema_name,
					c.relname AS table_name,
					a.attname AS column_name,
					pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
					t.typname AS udt_name,
					CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
					pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
					a.attnum
				FROM pg_catalog.pg_attribute a
				JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
				JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
				JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
				LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
				WHERE n.nspname = $1
					AND c.relname = ANY($2)
					AND a.attnum > 0
					AND NOT a.attisdropped
				ORDER BY n.nspname, c.relname, a.attnum`,
				[schemaName, mvNames],
			)
			for (const row of mvResult.rows) {
				allColumns.rows.push({
					table_schema: row.schema_name,
					table_name: row.table_name,
					column_name: row.column_name,
					data_type: row.data_type,
					udt_name: row.udt_name,
					is_nullable: row.is_nullable,
					column_default: row.column_default,
					character_maximum_length: null,
					is_primary_key: false,
				})
			}
		}

		// Group columns by schema.table
		const columns: SchemaData['columns'] = {}
		for (const row of allColumns.rows) {
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

		// Group indexes
		const indexes: SchemaData['indexes'] = {}
		for (const row of allIndexes.rows) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!indexes[key]) indexes[key] = []
			indexes[key].push({
				name: row.index_name,
				columns: Array.isArray(row.columns) ? row.columns : row.columns.replace(/^\{|\}$/g, '').split(','),
				isUnique: row.is_unique,
				isPrimary: row.is_primary,
			})
		}

		// Group foreign keys
		const foreignKeys: SchemaData['foreignKeys'] = {}
		for (const row of allForeignKeys.rows) {
			const key = `${row.table_schema}.${row.table_name}`
			if (!foreignKeys[key]) foreignKeys[key] = []
			foreignKeys[key].push({
				name: row.constraint_name,
				columns: Array.isArray(row.columns) ? row.columns : row.columns.replace(/^\{|\}$/g, '').split(','),
				referencedSchema: row.referenced_schema,
				referencedTable: row.referenced_table,
				referencedColumns: Array.isArray(row.referenced_columns) ? row.referenced_columns : row.referenced_columns.replace(/^\{|\}$/g, '').split(','),
				onUpdate: row.on_update,
				onDelete: row.on_delete,
			})
		}

		// Group referencing foreign keys
		const referencingForeignKeys: SchemaData['referencingForeignKeys'] = {}
		for (const row of allReferencingForeignKeys.rows) {
			const key = `${row.referenced_schema}.${row.referenced_table}`
			if (!referencingForeignKeys[key]) referencingForeignKeys[key] = []
			referencingForeignKeys[key].push({
				constraintName: row.constraint_name,
				referencingSchema: row.referencing_schema,
				referencingTable: row.referencing_table,
				referencingColumns: Array.isArray(row.referencing_columns) ? row.referencing_columns : row.referencing_columns.replace(/^\{|\}$/g, '').split(','),
				referencedColumns: Array.isArray(row.referenced_columns) ? row.referenced_columns : row.referenced_columns.replace(/^\{|\}$/g, '').split(','),
			})
		}

		// Ensure every table has entries
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

	private async getSchemas(queryable: pg.Pool | pg.PoolClient): Promise<SchemaInfo[]> {
		const result = await queryable.query(
			`SELECT schema_name AS name
			FROM information_schema.schemata
			WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
			ORDER BY schema_name`,
		)
		return result.rows as SchemaInfo[]
	}

	private async getTablesForSchema(queryable: pg.Pool | pg.PoolClient, schema: string): Promise<TableInfo[]> {
		const result = await queryable.query(
			`SELECT table_name AS name, table_type
			FROM information_schema.tables
			WHERE table_schema = $1
			ORDER BY table_name`,
			[schema],
		)
		return result.rows.map((row: any) => ({
			schema,
			name: row.name,
			type: row.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
		}))
	}

	private async getMaterializedViews(queryable: pg.Pool | pg.PoolClient, schema: string): Promise<TableInfo[]> {
		const result = await queryable.query(
			`SELECT matviewname
			FROM pg_matviews
			WHERE schemaname = $1
			ORDER BY matviewname`,
			[schema],
		)
		return result.rows.map((row: any) => ({
			schema,
			name: row.matviewname,
			type: 'materialized-view' as const,
		}))
	}

	// --- Transactions ---

	async beginTransaction(sessionId?: string): Promise<void> {
		this.ensureConnected()
		if (sessionId) {
			const session = this.sessions.get(sessionId)
			if (!session) throw new Error(`Session "${sessionId}" not found`)
			await session.client.query('BEGIN')
			session.txActive = true
		} else {
			const client = await this.pool!.connect()
			try {
				const pidResult = await client.query('SELECT pg_backend_pid() as pid')
				const pid = pidResult.rows[0].pid as number
				await client.query('BEGIN')
				this.sessions.set(DEFAULT_SESSION, { client, txActive: true, pid })
			} catch (err) {
				client.release()
				throw err
			}
		}
	}

	async commit(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		await session.client.query('COMMIT')
		session.txActive = false
		if (id === DEFAULT_SESSION) {
			session.client.release()
			this.sessions.delete(DEFAULT_SESSION)
		}
	}

	async rollback(sessionId?: string): Promise<void> {
		this.ensureConnected()
		const id = sessionId ?? DEFAULT_SESSION
		const session = this.sessions.get(id)
		if (!session) throw new Error('No active transaction')
		await session.client.query('ROLLBACK')
		session.txActive = false
		if (id === DEFAULT_SESSION) {
			session.client.release()
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

		const session = sessionId ? this.sessions.get(sessionId) : undefined
		if (sessionId && !session) throw new Error(`Session "${sessionId}" not found`)

		const client = session ? session.client : await this.pool!.connect()
		const ownClient = !session
		try {
			await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
			await client.query(`DECLARE ${cursorId} NO SCROLL CURSOR FOR ${sql}`, params)
			try {
				while (true) {
					if (signal?.aborted) {
						throw new DOMException('Aborted', 'AbortError')
					}
					const result = await client.query(`FETCH FORWARD ${batchSize} FROM ${cursorId}`)
					const rows = result.rows as Record<string, unknown>[]
					if (rows.length === 0) break
					yield rows
					if (rows.length < batchSize) break
				}
			} finally {
				await client.query(`CLOSE ${cursorId}`)
			}
			await client.query('COMMIT')
		} catch (err) {
			try {
				await client.query('ROLLBACK')
			} catch { /* ignore rollback errors */ }
			throw err
		} finally {
			if (ownClient) {
				;(client as pg.PoolClient).release()
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
		if (!this.pool || !this.connected) {
			throw new Error('Not connected. Call connect() first.')
		}
	}

	private resolveSession(sessionId?: string): SessionState | undefined {
		if (!sessionId) {
			return this.sessions.get(DEFAULT_SESSION)
		}
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Session "${sessionId}" not found`)
		return session
	}

	private mapDataType(dataType: string, udtName: string): DatabaseDataType {
		if (dataType === 'ARRAY') return DatabaseDataType.Array
		if (dataType === 'USER-DEFINED') {
			const u = udtName.toLowerCase()
			if (u === 'json' || u === 'jsonb') return DatabaseDataType.Json
			return DatabaseDataType.Enum
		}
		return mapPgDataType(dataType)
	}
}
