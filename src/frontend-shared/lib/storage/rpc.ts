import type { ConnectionConfig, ConnectionInfo } from '@dotaz/shared/types/connection'
import type { QueryHistoryEntry } from '@dotaz/shared/types/query'
import type { HistoryListParams, SavedView, SavedViewConfig } from '@dotaz/shared/types/rpc'
import type { WorkspaceState } from '@dotaz/shared/types/workspace'
import type { AppStateStorage } from '../app-state-storage'
import { rpc } from '../rpc'

export class RpcAppStateStorage implements AppStateStorage {
	readonly passConfigOnConnect = false

	async listConnections(): Promise<ConnectionInfo[]> {
		return rpc.connections.list()
	}

	async createConnection(
		name: string,
		config: ConnectionConfig,
		_rememberPassword?: boolean,
		readOnly?: boolean,
		color?: string,
		groupName?: string,
	): Promise<ConnectionInfo> {
		return rpc.connections.create({ name, config, readOnly, color, groupName })
	}

	async updateConnection(
		id: string,
		name: string,
		config: ConnectionConfig,
		_rememberPassword?: boolean,
		readOnly?: boolean,
		color?: string,
		groupName?: string,
	): Promise<ConnectionInfo> {
		return rpc.connections.update({ id, name, config, readOnly, color, groupName })
	}

	async deleteConnection(id: string): Promise<void> {
		await rpc.connections.delete({ id })
	}

	async listHistory(params: HistoryListParams): Promise<QueryHistoryEntry[]> {
		return rpc.history.list(params)
	}

	async addHistoryEntry(_entry: Omit<QueryHistoryEntry, 'id'>): Promise<void> {
		// No-op: backend's QueryExecutor already logs history
	}

	async clearHistory(connectionId?: string): Promise<void> {
		await rpc.history.clear({ connectionId })
	}

	async listViewsByConnection(connectionId: string): Promise<SavedView[]> {
		return rpc.views.listByConnection({ connectionId })
	}

	async saveView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): Promise<SavedView> {
		return rpc.views.save(params)
	}

	async updateView(params: { id: string; name: string; config: SavedViewConfig }): Promise<SavedView> {
		return rpc.views.update(params)
	}

	async deleteView(id: string): Promise<void> {
		await rpc.views.delete({ id })
	}

	async getEncryptedConfig(_id: string): Promise<string | undefined> {
		return undefined
	}

	async getRememberPassword(_id: string): Promise<boolean> {
		return true
	}

	async saveWorkspace(state: WorkspaceState): Promise<void> {
		await rpc.workspace.save({ data: JSON.stringify(state) })
	}

	async loadWorkspace(): Promise<WorkspaceState | null> {
		const data = await rpc.workspace.load()
		if (!data) return null
		try {
			return JSON.parse(data) as WorkspaceState
		} catch {
			return null
		}
	}
}
