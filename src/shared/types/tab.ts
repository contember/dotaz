// Tab types

export type TabType = "data-grid" | "sql-console" | "schema-viewer";

export interface TabInfo {
	id: string;
	type: TabType;
	title: string;
	connectionId: string;
	/** Schema and table for data-grid and schema-viewer tabs */
	schema?: string;
	table?: string;
	/** Database name (for multi-database PostgreSQL connections) */
	database?: string;
	/** Whether the tab has unsaved changes */
	dirty?: boolean;
	/** Associated saved view ID (if this tab is showing a saved view) */
	viewId?: string;
	/** Display name of the associated saved view */
	viewName?: string;
	/** Whether the view config has been modified from its saved state */
	viewModified?: boolean;
}
