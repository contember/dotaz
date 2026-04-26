import type { ConnectionConfig, ConnectionInfo } from '@dotaz/shared/types/connection'
import type { QueryHistoryEntry } from '@dotaz/shared/types/query'
import type { HistoryListParams, SavedView, SavedViewConfig } from '@dotaz/shared/types/rpc'
import type { WorkspaceState } from '@dotaz/shared/types/workspace'

export interface AppStateStorage {
	// Connections
	listConnections(): Promise<ConnectionInfo[]>
	createConnection(
		name: string,
		config: ConnectionConfig,
		rememberPassword?: boolean,
		readOnly?: boolean,
		color?: string,
		groupName?: string,
	): Promise<ConnectionInfo>
	updateConnection(
		id: string,
		name: string,
		config: ConnectionConfig,
		rememberPassword?: boolean,
		readOnly?: boolean,
		color?: string,
		groupName?: string,
	): Promise<ConnectionInfo>
	deleteConnection(id: string): Promise<void>

	// History
	listHistory(params: HistoryListParams): Promise<QueryHistoryEntry[]>
	addHistoryEntry(entry: Omit<QueryHistoryEntry, 'id'>): Promise<void>
	clearHistory(connectionId?: string): Promise<void>

	// Saved Views
	listViewsByConnection(connectionId: string): Promise<SavedView[]>
	saveView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): Promise<SavedView>
	updateView(params: { id: string; name: string; config: SavedViewConfig }): Promise<SavedView>
	deleteView(id: string): Promise<void>

	// Whether this adapter needs config + encrypted secrets to be passed on connect.
	// True for IndexedDB (web mode) — backend has no persistent storage of its own.
	// False for RPC storage (desktop) — backend already owns the connection record.
	readonly passConfigOnConnect: boolean
	getEncryptedSecrets(id: string): Promise<string | undefined>
	getRememberPassword(id: string): Promise<boolean>
	/**
	 * Persist a change to `config.activeDatabases` for a connection.
	 * Web/IndexedDB stores this in the plain `config` field — no re-encryption needed.
	 * Desktop is a no-op: the backend already persisted via the `databases.activate` RPC.
	 */
	updateConnectionActiveDatabases(id: string, activeDatabases: string[] | undefined): Promise<void>

	// Workspace persistence
	saveWorkspace(state: WorkspaceState): Promise<void>
	loadWorkspace(): Promise<WorkspaceState | null>
}
