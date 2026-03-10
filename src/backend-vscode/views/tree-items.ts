import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import type { DatabaseInfo, TableInfo } from '@dotaz/shared/types/database'
import type { SavedView } from '@dotaz/shared/types/rpc'
import * as vscode from 'vscode'

// ── Base tree item ──────────────────────────────────────────

export type DotazTreeItem =
	| GroupTreeItem
	| ConnectionTreeItem
	| DatabaseTreeItem
	| SchemaTreeItem
	| TableTreeItem
	| ViewTreeItem
	| SavedViewTreeItem

// ── Group ───────────────────────────────────────────────────

export class GroupTreeItem extends vscode.TreeItem {
	readonly type = 'group' as const
	constructor(
		public readonly groupName: string,
	) {
		super(groupName, vscode.TreeItemCollapsibleState.Expanded)
		this.id = `group:${groupName}`
		this.contextValue = 'group'
		this.iconPath = new vscode.ThemeIcon('folder')
	}
}

// ── Connection ──────────────────────────────────────────────

const CONNECTION_ICONS: Record<string, string> = {
	postgresql: 'database',
	sqlite: 'database',
	mysql: 'database',
}

export class ConnectionTreeItem extends vscode.TreeItem {
	readonly type = 'connection' as const
	constructor(
		public readonly conn: ConnectionInfo,
	) {
		super(
			conn.name,
			conn.state === 'connected'
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed,
		)

		const isConnected = conn.state === 'connected'
		const isError = conn.state === 'error'
		const isConnecting = conn.state === 'connecting' || conn.state === 'reconnecting'

		this.description = isConnected
			? 'connected'
			: isError
			? conn.error ?? 'error'
			: isConnecting
			? 'connecting...'
			: ''

		this.contextValue = isConnected
			? 'connection.connected'
			: 'connection.disconnected'

		this.iconPath = new vscode.ThemeIcon(
			CONNECTION_ICONS[conn.config.type] ?? 'database',
			isConnected
				? new vscode.ThemeColor('charts.green')
				: isError
				? new vscode.ThemeColor('charts.red')
				: undefined,
		)

		this.tooltip = new vscode.MarkdownString()
		this.tooltip.appendMarkdown(`**${conn.name}**\n\n`)
		this.tooltip.appendMarkdown(`Type: ${conn.config.type}\n\n`)
		if (conn.state !== 'disconnected') {
			this.tooltip.appendMarkdown(`Status: ${conn.state}`)
		}
		if (conn.readOnly) {
			this.tooltip.appendMarkdown(`\n\nRead-only`)
		}

		this.id = `conn:${conn.id}`

		// Double-click to connect
		if (!isConnected && !isConnecting) {
			this.command = {
				command: 'dotaz.connect',
				title: 'Connect',
				arguments: [conn.id],
			}
		}
	}
}

// ── Database (multi-db, e.g. PostgreSQL) ────────────────────

export class DatabaseTreeItem extends vscode.TreeItem {
	readonly type = 'database' as const
	constructor(
		public readonly connectionId: string,
		public readonly dbInfo: DatabaseInfo,
	) {
		super(dbInfo.name, vscode.TreeItemCollapsibleState.Collapsed)
		this.id = `db:${connectionId}:${dbInfo.name}`
		this.contextValue = dbInfo.isDefault ? 'database.default' : 'database'
		this.iconPath = new vscode.ThemeIcon('database')
		this.description = dbInfo.isDefault ? '(default)' : ''
	}
}

// ── Schema ──────────────────────────────────────────────────

export class SchemaTreeItem extends vscode.TreeItem {
	readonly type = 'schema' as const
	constructor(
		public readonly connectionId: string,
		public readonly schemaName: string,
		public readonly database: string | undefined,
	) {
		super(schemaName, vscode.TreeItemCollapsibleState.Collapsed)
		this.id = `schema:${connectionId}:${database ?? ''}:${schemaName}`
		this.contextValue = 'schema'
		this.iconPath = new vscode.ThemeIcon('symbol-namespace')
	}
}

// ── Table ───────────────────────────────────────────────────

export class TableTreeItem extends vscode.TreeItem {
	readonly type = 'table' as const
	constructor(
		public readonly connectionId: string,
		public readonly schemaName: string,
		public readonly tableInfo: TableInfo,
		public readonly database: string | undefined,
	) {
		const hasSavedViews = false // will be set by provider
		super(
			tableInfo.name,
			hasSavedViews
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
		)
		this.id = `table:${connectionId}:${database ?? ''}:${schemaName}:${tableInfo.name}`
		this.contextValue = 'table'
		this.iconPath = new vscode.ThemeIcon('symbol-class')

		// Click to open data grid
		this.command = {
			command: 'dotaz.openTable',
			title: 'Open Table',
			arguments: [connectionId, schemaName, tableInfo.name, database],
		}
	}
}

// ── Database View (view, materialized view) ──────────────────

export class ViewTreeItem extends vscode.TreeItem {
	readonly type = 'dbview' as const
	constructor(
		public readonly connectionId: string,
		public readonly schemaName: string,
		public readonly tableInfo: TableInfo,
		public readonly database: string | undefined,
	) {
		super(tableInfo.name, vscode.TreeItemCollapsibleState.None)
		this.id = `view:${connectionId}:${database ?? ''}:${schemaName}:${tableInfo.name}`
		this.contextValue = 'dbview'
		this.iconPath = new vscode.ThemeIcon(
			tableInfo.type === 'materialized-view' ? 'symbol-interface' : 'symbol-event',
		)

		this.command = {
			command: 'dotaz.openTable',
			title: 'Open View',
			arguments: [connectionId, schemaName, tableInfo.name, database],
		}
	}
}

// ── Saved View ──────────────────────────────────────────────

export class SavedViewTreeItem extends vscode.TreeItem {
	readonly type = 'savedView' as const
	constructor(
		public readonly connectionId: string,
		public readonly savedView: SavedView,
		public readonly database: string | undefined,
	) {
		super(savedView.name, vscode.TreeItemCollapsibleState.None)
		this.id = `savedview:${connectionId}:${savedView.id}`
		this.contextValue = 'savedView'
		this.iconPath = new vscode.ThemeIcon('filter')

		this.command = {
			command: 'dotaz.openSavedView',
			title: 'Open Saved View',
			arguments: [connectionId, savedView, database],
		}
	}
}
