import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { SchemaCache } from '../state/schema-cache'
import {
	ConnectionTreeItem,
	DatabaseTreeItem,
	type DotazTreeItem,
	GroupTreeItem,
	SavedViewTreeItem,
	SchemaTreeItem,
	TableTreeItem,
	ViewTreeItem,
} from './tree-items'
import * as vscode from 'vscode'

export class ConnectionTreeProvider implements vscode.TreeDataProvider<DotazTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<DotazTreeItem | undefined | null>()
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event

	constructor(
		private connectionManager: ConnectionManager,
		private appDb: AppDatabase,
		private schemaCache: SchemaCache,
	) {}

	refresh(item?: DotazTreeItem): void {
		this._onDidChangeTreeData.fire(item ?? null)
	}

	getTreeItem(element: DotazTreeItem): vscode.TreeItem {
		return element
	}

	async getChildren(element?: DotazTreeItem): Promise<DotazTreeItem[]> {
		if (!element) {
			return this.getRootChildren()
		}

		switch (element.type) {
			case 'group':
				return this.getGroupChildren(element)
			case 'connection':
				return this.getConnectionChildren(element)
			case 'database':
				return this.getDatabaseChildren(element)
			case 'schema':
				return this.getSchemaChildren(element)
			case 'table':
				return this.getTableChildren(element)
			default:
				return []
		}
	}

	// ── Root level: groups and ungrouped connections ─────────

	private getRootChildren(): DotazTreeItem[] {
		const connections = this.connectionManager.listConnections()
		const groups = new Map<string, ConnectionInfo[]>()
		const ungrouped: ConnectionInfo[] = []

		for (const conn of connections) {
			if (conn.groupName) {
				const list = groups.get(conn.groupName) ?? []
				list.push(conn)
				groups.set(conn.groupName, list)
			} else {
				ungrouped.push(conn)
			}
		}

		const items: DotazTreeItem[] = []

		// Groups first (sorted)
		for (const name of [...groups.keys()].sort()) {
			items.push(new GroupTreeItem(name))
		}

		// Ungrouped connections
		for (const conn of ungrouped) {
			items.push(new ConnectionTreeItem(conn))
		}

		return items
	}

	// ── Group children: connections in the group ────────────

	private getGroupChildren(group: GroupTreeItem): DotazTreeItem[] {
		const connections = this.connectionManager.listConnections()
		return connections
			.filter((c) => c.groupName === group.groupName)
			.map((c) => new ConnectionTreeItem(c))
	}

	// ── Connection children: databases or schemas ───────────

	private getConnectionChildren(item: ConnectionTreeItem): DotazTreeItem[] {
		const conn = item.conn
		if (conn.state !== 'connected') return []

		const supportsMultiDb = CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase

		if (supportsMultiDb) {
			return this.getMultiDatabaseChildren(conn)
		}

		// Single-database: show schemas directly under connection
		return this.getSchemasForConnection(conn.id, undefined)
	}

	// ── Multi-database: list active databases ───────────────

	private getMultiDatabaseChildren(conn: ConnectionInfo): DotazTreeItem[] {
		const defaultDb = getDefaultDatabase(conn.config)
		const activeDbs = ('activeDatabases' in conn.config ? conn.config.activeDatabases : undefined) ?? []
		const allDbs = [defaultDb, ...activeDbs.filter((db) => db !== defaultDb)]

		return allDbs.map((dbName) => {
			const isDefault = dbName === defaultDb
			return new DatabaseTreeItem(conn.id, {
				name: dbName,
				isDefault,
				isActive: true,
			})
		})
	}

	// ── Database children: schemas ──────────────────────────

	private getDatabaseChildren(item: DatabaseTreeItem): DotazTreeItem[] {
		return this.getSchemasForConnection(item.connectionId, item.dbInfo.name)
	}

	// ── Schema children: tables and views ───────────────────

	private getSchemaChildren(item: SchemaTreeItem): DotazTreeItem[] {
		const schema = this.schemaCache.get(item.connectionId, item.database)
		if (!schema) return []

		const tables = schema.tables[item.schemaName] ?? []
		const savedViews = this.appDb.listSavedViewsByConnection(item.connectionId)

		const items: DotazTreeItem[] = []

		for (const table of tables) {
			if (table.type === 'table') {
				const tableSavedViews = savedViews.filter(
					(v) => v.schemaName === item.schemaName && v.tableName === table.name,
				)
				const treeItem = new TableTreeItem(item.connectionId, item.schemaName, table, item.database)
				if (tableSavedViews.length > 0) {
					treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
				}
				items.push(treeItem)
			} else {
				items.push(new ViewTreeItem(item.connectionId, item.schemaName, table, item.database))
			}
		}

		return items
	}

	// ── Table children: saved views ─────────────────────────

	private getTableChildren(item: TableTreeItem): DotazTreeItem[] {
		const savedViews = this.appDb.listSavedViews(item.connectionId, item.schemaName, item.tableInfo.name)
		return savedViews.map(
			(v) => new SavedViewTreeItem(item.connectionId, v, item.database),
		)
	}

	// ── Helpers ─────────────────────────────────────────────

	private getSchemasForConnection(connectionId: string, database: string | undefined): DotazTreeItem[] {
		const schema = this.schemaCache.get(connectionId, database)
		if (!schema) return []

		const schemas = schema.schemas

		// If only one schema (e.g. SQLite "main"), flatten: show tables directly
		if (schemas.length === 1) {
			const schemaName = schemas[0].name
			const tables = schema.tables[schemaName] ?? []
			const savedViews = this.appDb.listSavedViewsByConnection(connectionId)

			return tables.map((table) => {
				if (table.type === 'table') {
					const tableSavedViews = savedViews.filter(
						(v) => v.schemaName === schemaName && v.tableName === table.name,
					)
					const treeItem = new TableTreeItem(connectionId, schemaName, table, database)
					if (tableSavedViews.length > 0) {
						treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
					}
					return treeItem
				}
				return new ViewTreeItem(connectionId, schemaName, table, database)
			})
		}

		// Multiple schemas: show schema nodes
		return schemas.map(
			(s) => new SchemaTreeItem(connectionId, s.name, database),
		)
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose()
	}
}
