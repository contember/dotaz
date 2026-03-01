import type { ConnectionConfig, ConnectionInfo } from "../../shared/types/connection";
import type { QueryHistoryEntry } from "../../shared/types/query";
import type { SavedView, SavedViewConfig, HistoryListParams } from "../../shared/types/rpc";

export interface AppStateStorage {
	// Connections
	listConnections(): Promise<ConnectionInfo[]>;
	createConnection(name: string, config: ConnectionConfig, rememberPassword?: boolean): Promise<ConnectionInfo>;
	updateConnection(id: string, name: string, config: ConnectionConfig, rememberPassword?: boolean): Promise<ConnectionInfo>;
	deleteConnection(id: string): Promise<void>;

	// History
	listHistory(params: HistoryListParams): Promise<QueryHistoryEntry[]>;
	addHistoryEntry(entry: Omit<QueryHistoryEntry, "id">): Promise<void>;
	clearHistory(connectionId?: string): Promise<void>;

	// Saved Views
	listViewsByConnection(connectionId: string): Promise<SavedView[]>;
	saveView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): Promise<SavedView>;
	updateView(params: { id: string; name: string; config: SavedViewConfig }): Promise<SavedView>;
	deleteView(id: string): Promise<void>;

	// Whether this adapter needs encrypted config to be passed on connect
	readonly passConfigOnConnect: boolean;
	getEncryptedConfig(id: string): Promise<string | undefined>;
	getRememberPassword(id: string): Promise<boolean>;
}
