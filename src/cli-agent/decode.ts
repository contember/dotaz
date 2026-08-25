// RPC payloads arrive as untyped JSON. Everything the CLI consumes is narrowed here so no
// command has to guess at a shape (and so nothing needs an `as` cast).

import type { ConnectionState, ConnectionType } from '@dotaz/shared/types/connection'
import type {
	ColumnInfo,
	DatabaseInfo,
	ForeignKeyInfo,
	IndexInfo,
	ReferencingForeignKeyInfo,
	SchemaData,
	SchemaInfo,
	TableInfo,
} from '@dotaz/shared/types/database'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { QueryHistoryEntry, QueryHistoryStatus, QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'
import type {
	AgentHelloResult,
	Proposal,
	ProposalStatus,
	SearchDatabaseResult,
	SearchMatch,
	UiSnapshot,
	UiTabSnapshot,
} from '@dotaz/shared/types/rpc'
import { CliError, EXIT } from './errors'

// ── primitives ─────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rec(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback
}

function optStr(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optNum(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback
}

function strings(value: unknown): string[] {
	return arr(value).filter((v): v is string => typeof v === 'string')
}

/** Narrow a wire string to a union member without asserting. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	for (const candidate of allowed) {
		if (candidate === value) return candidate
	}
	return fallback
}

function decodeError(what: string): CliError {
	return new CliError(EXIT.database, `Dotaz returned an unexpected payload for ${what}`)
}

// ── connections ────────────────────────────────────────────

const CONNECTION_TYPES: readonly ConnectionType[] = ['postgresql', 'sqlite', 'mysql']
const CONNECTION_STATES: readonly ConnectionState[] = ['disconnected', 'connecting', 'connected', 'reconnecting', 'error']

/** Only the parts of `ConnectionInfo` the CLI needs — credentials never leave the app. */
export interface CliConnection {
	id: string
	name: string
	type: ConnectionType
	state: ConnectionState
	readOnly: boolean
	groupName?: string
	error?: string
	/** SQLite file path / server database name, used for display only. */
	defaultDatabase?: string
}

export function decodeConnections(payload: unknown): CliConnection[] {
	if (!Array.isArray(payload)) throw decodeError('connections.list')
	return payload.map((entry) => {
		const obj = rec(entry)
		const config = rec(obj.config)
		return {
			id: str(obj.id),
			name: str(obj.name),
			type: oneOf(config.type, CONNECTION_TYPES, 'postgresql'),
			state: oneOf(obj.state, CONNECTION_STATES, 'disconnected'),
			readOnly: bool(obj.readOnly),
			groupName: optStr(obj.groupName),
			error: optStr(obj.error),
			defaultDatabase: optStr(config.database) ?? optStr(config.path),
		}
	}).filter((c) => c.id.length > 0)
}

export function decodeDatabases(payload: unknown): DatabaseInfo[] {
	if (!Array.isArray(payload)) throw decodeError('databases.list')
	return payload.map((entry) => {
		const obj = rec(entry)
		return { name: str(obj.name), isDefault: bool(obj.isDefault), isActive: bool(obj.isActive) }
	}).filter((d) => d.name.length > 0)
}

// ── schema ─────────────────────────────────────────────────

const TABLE_TYPES: readonly TableInfo['type'][] = ['table', 'view', 'materialized-view']

function decodeDataType(value: unknown): DatabaseDataType {
	for (const candidate of Object.values(DatabaseDataType)) {
		if (candidate === value) return candidate
	}
	return DatabaseDataType.Unknown
}

function decodeTable(value: unknown): TableInfo {
	const obj = rec(value)
	return {
		schema: str(obj.schema),
		name: str(obj.name),
		type: oneOf(obj.type, TABLE_TYPES, 'table'),
		rowCount: optNum(obj.rowCount),
	}
}

function decodeColumn(value: unknown): ColumnInfo {
	const obj = rec(value)
	return {
		name: str(obj.name),
		dataType: decodeDataType(obj.dataType),
		nullable: bool(obj.nullable, true),
		defaultValue: typeof obj.defaultValue === 'string' ? obj.defaultValue : null,
		isPrimaryKey: bool(obj.isPrimaryKey),
		isAutoIncrement: bool(obj.isAutoIncrement),
		maxLength: optNum(obj.maxLength),
	}
}

function decodeIndex(value: unknown): IndexInfo {
	const obj = rec(value)
	return { name: str(obj.name), columns: strings(obj.columns), isUnique: bool(obj.isUnique), isPrimary: bool(obj.isPrimary) }
}

function decodeForeignKey(value: unknown): ForeignKeyInfo {
	const obj = rec(value)
	return {
		name: str(obj.name),
		columns: strings(obj.columns),
		referencedSchema: str(obj.referencedSchema),
		referencedTable: str(obj.referencedTable),
		referencedColumns: strings(obj.referencedColumns),
		onUpdate: str(obj.onUpdate),
		onDelete: str(obj.onDelete),
	}
}

function decodeReferencingForeignKey(value: unknown): ReferencingForeignKeyInfo {
	const obj = rec(value)
	return {
		constraintName: str(obj.constraintName),
		referencingSchema: str(obj.referencingSchema),
		referencingTable: str(obj.referencingTable),
		referencingColumns: strings(obj.referencingColumns),
		referencedColumns: strings(obj.referencedColumns),
	}
}

function decodeMap<T>(value: unknown, decode: (v: unknown) => T): Record<string, T[]> {
	const out: Record<string, T[]> = {}
	for (const [key, entries] of Object.entries(rec(value))) {
		out[key] = arr(entries).map(decode)
	}
	return out
}

export function decodeSchemaData(payload: unknown): SchemaData {
	if (!isRecord(payload)) throw decodeError('agent.schema')
	const schemas: SchemaInfo[] = arr(payload.schemas)
		.map((entry) => ({ name: str(rec(entry).name) }))
		.filter((s) => s.name.length > 0)
	return {
		schemas,
		tables: decodeMap(payload.tables, decodeTable),
		columns: decodeMap(payload.columns, decodeColumn),
		indexes: decodeMap(payload.indexes, decodeIndex),
		foreignKeys: decodeMap(payload.foreignKeys, decodeForeignKey),
		referencingForeignKeys: decodeMap(payload.referencingForeignKeys, decodeReferencingForeignKey),
	}
}

// ── queries ────────────────────────────────────────────────

function decodeResultColumn(value: unknown): QueryResultColumn {
	const obj = rec(value)
	return { name: str(obj.name), dataType: decodeDataType(obj.dataType) }
}

function decodeQueryResult(value: unknown): QueryResult {
	const obj = rec(value)
	return {
		columns: arr(obj.columns).map(decodeResultColumn),
		rows: arr(obj.rows).map((row) => rec(row)),
		rowCount: num(obj.rowCount),
		affectedRows: optNum(obj.affectedRows),
		durationMs: num(obj.durationMs),
		error: optStr(obj.error),
	}
}

export function decodeQueryResults(payload: unknown): QueryResult[] {
	if (Array.isArray(payload)) return payload.map(decodeQueryResult)
	if (isRecord(payload)) return [decodeQueryResult(payload)]
	throw decodeError('agent.query')
}

// ── history & search ───────────────────────────────────────

const HISTORY_STATUSES: readonly QueryHistoryStatus[] = ['success', 'error']

export function decodeHistory(payload: unknown): QueryHistoryEntry[] {
	if (!Array.isArray(payload)) throw decodeError('history.list')
	return payload.map((entry) => {
		const obj = rec(entry)
		return {
			id: num(obj.id),
			connectionId: str(obj.connectionId),
			database: optStr(obj.database),
			sql: str(obj.sql),
			status: oneOf(obj.status, HISTORY_STATUSES, 'success'),
			durationMs: optNum(obj.durationMs),
			rowCount: optNum(obj.rowCount),
			errorMessage: optStr(obj.errorMessage),
			executedAt: str(obj.executedAt),
		}
	})
}

function decodeSearchMatch(value: unknown): SearchMatch {
	const obj = rec(value)
	return { schema: str(obj.schema), table: str(obj.table), column: str(obj.column), row: rec(obj.row) }
}

export function decodeSearchResult(payload: unknown): SearchDatabaseResult {
	if (!isRecord(payload)) throw decodeError('agent.search')
	return {
		matches: arr(payload.matches).map(decodeSearchMatch),
		searchedTables: num(payload.searchedTables),
		totalMatches: num(payload.totalMatches),
		cancelled: bool(payload.cancelled),
		elapsedMs: num(payload.elapsedMs),
	}
}

// ── agent / proposals ──────────────────────────────────────

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
	'pending',
	'approved',
	'rejected',
	'executed',
	'failed',
	'cancelled',
	'expired',
]

export function decodeProposal(payload: unknown): Proposal {
	if (!isRecord(payload)) throw decodeError('agent.proposals')
	const result = isRecord(payload.result)
		? { affectedRows: optNum(payload.result.affectedRows), statements: optNum(payload.result.statements) }
		: undefined
	return {
		id: str(payload.id),
		connectionId: str(payload.connectionId),
		database: optStr(payload.database),
		sql: str(payload.sql),
		reason: optStr(payload.reason),
		status: oneOf(payload.status, PROPOSAL_STATUSES, 'pending'),
		createdAt: num(payload.createdAt),
		resolvedAt: optNum(payload.resolvedAt),
		result,
		error: optStr(payload.error),
	}
}

export function decodeProposals(payload: unknown): Proposal[] {
	if (!Array.isArray(payload)) throw decodeError('agent.proposals.list')
	return payload.map(decodeProposal)
}

export function decodeProposalId(payload: unknown): string {
	if (!isRecord(payload)) throw decodeError('agent.proposeWrite')
	const id = str(payload.proposalId)
	if (!id) throw decodeError('agent.proposeWrite')
	return id
}

export function decodeAgentHello(payload: unknown): AgentHelloResult {
	if (!isRecord(payload)) throw decodeError('agent.hello')
	return {
		version: str(payload.version, 'unknown'),
		mode: oneOf(payload.mode, ['desktop', 'web', 'demo'] as const, 'desktop'),
		pid: num(payload.pid),
		protocol: num(payload.protocol),
	}
}

// ── ui ─────────────────────────────────────────────────────

function decodeUiTab(value: unknown): UiTabSnapshot {
	const obj = rec(value)
	return {
		id: str(obj.id),
		type: str(obj.type),
		title: str(obj.title),
		connectionId: str(obj.connectionId),
		database: optStr(obj.database),
		schema: optStr(obj.schema),
		table: optStr(obj.table),
		sql: optStr(obj.sql),
	}
}

export function decodeUiSnapshot(payload: unknown): UiSnapshot {
	if (!isRecord(payload)) throw decodeError('ui.state')
	return {
		tabs: arr(payload.tabs).map(decodeUiTab),
		activeTabId: optStr(payload.activeTabId) ?? null,
		activeConnectionId: optStr(payload.activeConnectionId) ?? null,
		updatedAt: num(payload.updatedAt),
	}
}
