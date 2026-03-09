import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { SqlDialect } from '@dotaz/shared/sql'
import { MysqlDialect, PostgresDialect, SqliteDialect } from '@dotaz/shared/sql'
import type { ConnectionConfig, ConnectionInfo, ConnectionState } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { ConnectionType } from '@dotaz/shared/types/connection'
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
import { friendlyErrorMessage, messages, rpc } from '../lib/rpc'
import { storage } from '../lib/storage'
import { uiStore } from './ui'

export interface SchemaTree {
	schemas: SchemaInfo[]
	tables: Record<string, TableInfo[]> // keyed by schema name
}

export interface ConnectionStoreState {
	connections: ConnectionInfo[]
	activeConnectionId: string | null
	// Nested: schemaTrees[connectionId][databaseName] = SchemaTree (for backward compat)
	schemaTrees: Record<string, Record<string, SchemaTree>>
	// Full schema data: schemaDataCache[connectionId][databaseName] = SchemaData
	schemaDataCache: Record<string, Record<string, SchemaData>>
	availableDatabases: Record<string, DatabaseInfo[]>
}

const [state, setState] = createStore<ConnectionStoreState>({
	connections: [],
	activeConnectionId: null,
	schemaTrees: {},
	schemaDataCache: {},
	availableDatabases: {},
})

const dialectCache = new Map<ConnectionType, SqlDialect>()

/**
 * Optional hook called before disconnecting.
 * Returns false to prevent disconnect.
 */
let beforeDisconnectHook: ((connectionId: string) => boolean) | null = null

function setBeforeDisconnectHook(hook: ((connectionId: string) => boolean) | null) {
	beforeDisconnectHook = hook
}

/**
 * Optional hook called when a transaction is lost due to connection reset.
 * Used to decouple connections store from editor store (avoids circular dependency).
 */
let onTransactionLost: ((connectionId: string) => void) | null = null

function setOnTransactionLost(callback: ((connectionId: string) => void) | null) {
	onTransactionLost = callback
}

// ── Password prompt signal ───────────────────────────────
const [passwordPrompt, setPasswordPrompt] = createSignal<
	{
		connectionId: string
		connectionName: string
		resolve: (password: string | null) => void
	} | null
>(null)

// ── Schema loading ───────────────────────────────────────

async function loadSchemaTree(connectionId: string, database?: string) {
	const schemaData = await rpc.schema.load({ connectionId, database })

	const dbKey = database ?? getDefaultDatabaseKey(connectionId)

	// Store full schema data
	if (!state.schemaDataCache[connectionId]) {
		setState('schemaDataCache', connectionId, {})
	}
	setState('schemaDataCache', connectionId, dbKey, schemaData)

	// Also update the legacy SchemaTree for backward compat
	if (!state.schemaTrees[connectionId]) {
		setState('schemaTrees', connectionId, {})
	}
	setState('schemaTrees', connectionId, dbKey, {
		schemas: schemaData.schemas,
		tables: schemaData.tables,
	})
}

function getDefaultDatabaseKey(connectionId: string): string {
	const conn = state.connections.find((c) => c.id === connectionId)
	if (!conn) return '__default__'
	return getDefaultDatabase(conn.config)
}

async function loadAvailableDatabases(connectionId: string) {
	try {
		const databases = await rpc.databases.list({ connectionId })
		setState('availableDatabases', connectionId, databases)
	} catch (err) {
		console.debug('Failed to load available databases:', err instanceof Error ? err.message : err)
	}
}

async function activateDatabase(connectionId: string, database: string) {
	await rpc.databases.activate({ connectionId, database })
	await loadSchemaTree(connectionId, database)
	await loadAvailableDatabases(connectionId)
}

async function deactivateDatabase(connectionId: string, database: string) {
	await rpc.databases.deactivate({ connectionId, database })

	// Remove schema tree and schema data cache for this database
	if (state.schemaTrees[connectionId]) {
		setState('schemaTrees', connectionId, database, undefined!)
	}
	if (state.schemaDataCache[connectionId]) {
		setState('schemaDataCache', connectionId, database, undefined!)
	}

	await loadAvailableDatabases(connectionId)
}

// ── Actions ──────────────────────────────────────────────

async function loadConnections() {
	const list = await storage.listConnections()
	setState('connections', list)
	// Load schema trees for connections the backend reports as already connected
	// (e.g. after a frontend-only reload while the backend stayed alive)
	for (const conn of list) {
		if (conn.state === 'connected') {
			loadSchemaTreesForConnection(conn)
		}
	}
}

async function loadSchemaTreesForConnection(conn: ConnectionInfo) {
	// Load default database schema tree
	loadSchemaTree(conn.id).catch(() => {
		uiStore.addToast('warning', `Failed to load schema for "${conn.name}".`)
	})

	// For multi-database types, load active databases and their schema trees
	if (CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase) {
		loadAvailableDatabases(conn.id)
		const activeDbs = ('activeDatabases' in conn.config ? conn.config.activeDatabases : undefined) ?? []
		for (const db of activeDbs) {
			if (db !== getDefaultDatabase(conn.config)) {
				loadSchemaTree(conn.id, db).catch(() => {
					uiStore.addToast('warning', `Failed to load schema for "${conn.name}" database "${db}".`)
				})
			}
		}
	}
}

async function createConnection(
	name: string,
	config: ConnectionConfig,
	rememberPassword = true,
	readOnly?: boolean,
	color?: string,
	groupName?: string,
): Promise<ConnectionInfo> {
	const conn = await storage.createConnection(name, config, rememberPassword, readOnly, color, groupName)
	setState('connections', (prev) => [...prev, conn])
	return conn
}

async function updateConnection(
	id: string,
	name: string,
	config: ConnectionConfig,
	rememberPassword?: boolean,
	readOnly?: boolean,
	color?: string,
	groupName?: string,
): Promise<ConnectionInfo> {
	const conn = await storage.updateConnection(id, name, config, rememberPassword, readOnly, color, groupName)
	setState('connections', (c) => c.id === id, conn)
	return conn
}

async function setReadOnly(id: string, readOnly: boolean): Promise<void> {
	try {
		const conn = await rpc.connections.setReadOnly({ id, readOnly })
		setState('connections', (c) => c.id === id, 'readOnly', conn.readOnly)
	} catch {
		uiStore.addToast('warning', 'Failed to update read-only setting.')
	}
}

async function setConnectionGroup(id: string, groupName: string | null): Promise<void> {
	try {
		const conn = await rpc.connections.setGroup({ id, groupName })
		setState('connections', (c) => c.id === id, 'groupName', conn.groupName)
	} catch {
		uiStore.addToast('warning', 'Failed to update connection group.')
	}
}

async function renameConnectionGroup(oldName: string, newName: string): Promise<void> {
	try {
		await rpc.connections.renameGroup({ oldName, newName })
		setState('connections', (c) => c.groupName === oldName, 'groupName', newName)
	} catch {
		uiStore.addToast('warning', 'Failed to rename group.')
	}
}

async function deleteConnectionGroup(groupName: string): Promise<void> {
	try {
		await rpc.connections.deleteGroup({ groupName })
		setState('connections', (c) => c.groupName === groupName, 'groupName', undefined)
	} catch {
		uiStore.addToast('warning', 'Failed to delete group.')
	}
}

async function deleteConnection(id: string) {
	try {
		await storage.deleteConnection(id)
	} catch (err) {
		uiStore.addToast('warning', 'Failed to delete connection from storage.')
		throw err
	}
	setState('connections', (prev) => prev.filter((c) => c.id !== id))
	// Clean up schema trees, schema data cache, and available databases
	setState('schemaTrees', id, undefined!)
	setState('schemaDataCache', id, undefined!)
	setState('availableDatabases', id, undefined!)
	if (state.activeConnectionId === id) {
		setState('activeConnectionId', null)
	}
}

async function connectTo(id: string, password?: string) {
	// If adapter needs config on connect and password not remembered, prompt for it
	if (storage.passConfigOnConnect && !password) {
		const remember = await storage.getRememberPassword(id)
		if (!remember) {
			const conn = state.connections.find((c) => c.id === id)
			const connName = conn?.name ?? 'Connection'
			const prompted = await promptForPassword(id, connName)
			if (!prompted) return // User cancelled
			password = prompted
		}
	}

	updateConnectionState(id, 'connecting')
	try {
		if (storage.passConfigOnConnect) {
			const encryptedConfig = await storage.getEncryptedConfig(id)
			const conn = state.connections.find((c) => c.id === id)
			await rpc.connections.connect({ connectionId: id, password, encryptedConfig, name: conn?.name })
		} else {
			await rpc.connections.connect({ connectionId: id, password })
		}
		// Status will be updated via the statusChanged event
	} catch (err) {
		const message = friendlyErrorMessage(err)
		updateConnectionState(id, 'error', message)
	}
}

function promptForPassword(connectionId: string, connectionName: string): Promise<string | null> {
	return new Promise((resolve) => {
		setPasswordPrompt({ connectionId, connectionName, resolve })
	})
}

function resolvePasswordPrompt(password: string | null) {
	const prompt = passwordPrompt()
	if (prompt) {
		prompt.resolve(password)
		setPasswordPrompt(null)
	}
}

async function disconnectFrom(id: string) {
	if (beforeDisconnectHook && !beforeDisconnectHook(id)) {
		return
	}
	await rpc.connections.disconnect({ connectionId: id })
	// Status will be updated via the statusChanged event
	// Clean up schema trees, schema data cache, and available databases
	setState('schemaTrees', id, undefined!)
	setState('schemaDataCache', id, undefined!)
	setState('availableDatabases', id, undefined!)
}

function setActiveConnection(id: string | null) {
	setState('activeConnectionId', id)
}

async function getRememberPassword(id: string): Promise<boolean> {
	return storage.getRememberPassword(id)
}

// ── Internal helpers ─────────────────────────────────────

function updateConnectionState(connectionId: string, connState: ConnectionState, error?: string) {
	const idx = state.connections.findIndex((c) => c.id === connectionId)
	if (idx === -1) return
	setState('connections', idx, 'state', connState)
	if (error !== undefined) {
		setState('connections', idx, 'error', error)
	} else {
		setState('connections', idx, 'error', undefined)
	}
}

// ── Backend event listener ───────────────────────────────

export function initConnectionsListener(): () => void {
	return messages.onConnectionStatusChanged((event) => {
		updateConnectionState(event.connectionId, event.state, event.error)
		if (event.state === 'connected') {
			const conn = state.connections.find((c) => c.id === event.connectionId)
			if (conn) {
				loadSchemaTreesForConnection(conn)
			} else {
				loadSchemaTree(event.connectionId)
			}
		}
		if (event.state === 'connected' && event.transactionLost) {
			onTransactionLost?.(event.connectionId)
			uiStore.addToast('warning', 'Connection was lost and restored. Active transaction was rolled back by the server.')
		}
		if (event.state === 'error' && event.error) {
			const conn = state.connections.find((c) => c.id === event.connectionId)
			const name = conn?.name ?? 'Connection'
			// Create an error-like object with code for friendlyErrorMessage
			const errObj = event.errorCode
				? Object.assign(new Error(event.error), { code: event.errorCode })
				: event.error
			uiStore.addToast('error', `${name}: ${friendlyErrorMessage(errObj)}`)
		}
	})
}

// ── Export ────────────────────────────────────────────────

export const connectionsStore = {
	get connections() {
		return state.connections
	},
	get connectedConnections() {
		return state.connections.filter((c) => c.state === 'connected')
	},
	get activeConnectionId() {
		return state.activeConnectionId
	},
	get activeConnection() {
		return state.connections.find((c) => c.id === state.activeConnectionId) ?? null
	},
	get schemaTrees() {
		return state.schemaTrees
	},
	get passwordPrompt() {
		return passwordPrompt()
	},
	get availableDatabases() {
		return state.availableDatabases
	},
	getSchemaTree(connectionId: string, database?: string): SchemaTree | undefined {
		const connTrees = state.schemaTrees[connectionId]
		if (!connTrees) return undefined
		const dbKey = database ?? getDefaultDatabaseKey(connectionId)
		return connTrees[dbKey]
	},
	getSchemaData(connectionId: string, database?: string): SchemaData | undefined {
		const connCache = state.schemaDataCache[connectionId]
		if (!connCache) return undefined
		const dbKey = database ?? getDefaultDatabaseKey(connectionId)
		return connCache[dbKey]
	},
	getColumns(connectionId: string, schema: string, table: string, database?: string): ColumnInfo[] {
		const data = this.getSchemaData(connectionId, database)
		return data?.columns[`${schema}.${table}`] ?? []
	},
	getIndexes(connectionId: string, schema: string, table: string, database?: string): IndexInfo[] {
		const data = this.getSchemaData(connectionId, database)
		return data?.indexes[`${schema}.${table}`] ?? []
	},
	getForeignKeys(connectionId: string, schema: string, table: string, database?: string): ForeignKeyInfo[] {
		const data = this.getSchemaData(connectionId, database)
		return data?.foreignKeys[`${schema}.${table}`] ?? []
	},
	getReferencingForeignKeys(connectionId: string, schema: string, table: string, database?: string): ReferencingForeignKeyInfo[] {
		const data = this.getSchemaData(connectionId, database)
		return data?.referencingForeignKeys[`${schema}.${table}`] ?? []
	},
	getActiveDatabaseNames(connectionId: string): string[] {
		const connTrees = state.schemaTrees[connectionId]
		if (!connTrees) return []
		return Object.keys(connTrees)
	},
	getAvailableDatabases(connectionId: string): DatabaseInfo[] {
		return state.availableDatabases[connectionId] ?? []
	},
	getSchemaNames(connectionId: string, database?: string): string[] {
		const tree = this.getSchemaTree(connectionId, database)
		if (!tree) return []
		return tree.schemas.map((s) => s.name)
	},
	getConnectionType(connectionId: string): ConnectionType | undefined {
		const conn = state.connections.find((c) => c.id === connectionId)
		return conn?.config.type
	},
	getDialect(connectionId: string): SqlDialect {
		const type = this.getConnectionType(connectionId) ?? 'postgresql'
		let dialect = dialectCache.get(type)
		if (!dialect) {
			switch (type) {
				case 'sqlite':
					dialect = new SqliteDialect()
					break
				case 'mysql':
					dialect = new MysqlDialect()
					break
				default:
					dialect = new PostgresDialect()
					break
			}
			dialectCache.set(type, dialect)
		}
		return dialect
	},
	isReadOnly(connectionId: string): boolean {
		const conn = state.connections.find((c) => c.id === connectionId)
		return conn?.readOnly === true
	},
	getRememberPassword,
	loadConnections,
	createConnection,
	updateConnection,
	setReadOnly,
	deleteConnection,
	connectTo,
	disconnectFrom,
	setActiveConnection,
	loadSchemaTree,
	loadAvailableDatabases,
	activateDatabase,
	deactivateDatabase,
	setConnectionGroup,
	renameConnectionGroup,
	deleteConnectionGroup,
	setBeforeDisconnectHook,
	setOnTransactionLost,
	resolvePasswordPrompt,
}
