import type { TabInfo } from '@dotaz/shared/types/tab'
import { connectionsStore } from '../stores/connections'

/**
 * Build a breadcrumb-style context string for a tab showing
 * connection name, database and schema. The table name is already
 * visible in the tab label so it is not repeated here.
 */
export function formatTabContext(tab: TabInfo | null | undefined): string {
	if (!tab) return ''
	const conn = connectionsStore.connections.find((c) => c.id === tab.connectionId)
	const parts: string[] = []
	if (conn) parts.push(conn.name)
	if (tab.database) parts.push(tab.database)
	if (tab.schema) parts.push(tab.schema)
	return parts.join(' · ')
}

/**
 * Build a window title for the given tab:
 * "schema.table - connection / database - Dotaz" (or similar, skipping missing parts).
 *
 * Uses ASCII-only separators because Electrobun's Linux X11 backend sets the
 * window title via XStoreName, which mangles UTF-8 (em-dash, middle-dot, etc.)
 * as Latin-1. Once that's fixed upstream we can switch back to " — " / " · ".
 */
export function formatWindowTitle(tab: TabInfo | null | undefined): string {
	if (!tab) return 'Dotaz'
	const conn = connectionsStore.connections.find((c) => c.id === tab.connectionId)
	const context: string[] = []
	if (conn) context.push(conn.name)
	if (tab.database) context.push(tab.database)
	const contextStr = context.join(' / ')
	// Replace non-ASCII separators (em-dash, middle-dot, etc.) that appear in tab
	// titles — XStoreName on Linux mangles them as Latin-1.
	const rawLabel = tab.viewName ? `${tab.title} (${tab.viewName})` : tab.title
	const label = rawLabel.replace(/\s*[—–]\s*/g, ' - ').replace(/\s*·\s*/g, ' / ')
	if (contextStr) return `${label} - ${contextStr} - Dotaz`
	return `${label} - Dotaz`
}
