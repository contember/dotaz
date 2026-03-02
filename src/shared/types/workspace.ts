import type { TabType } from "./tab";
import type { SortColumn, ColumnFilter } from "./grid";

/** Persisted workspace state — restored on app restart. */
export interface WorkspaceState {
	tabs: WorkspaceTab[];
	activeTabId: string | null;
	layout: WorkspaceLayout;
}

/** Persisted state for a single tab. */
export interface WorkspaceTab {
	id: string;
	type: TabType;
	title: string;
	connectionId: string;
	schema?: string;
	table?: string;
	database?: string;
	viewId?: string;
	viewName?: string;
	/** SQL editor content (sql-console tabs only) */
	editorContent?: string;
	/** Cursor position in the editor (sql-console tabs only) */
	editorCursorPosition?: number;
	/** Transaction mode: "auto-commit" | "manual" (sql-console tabs only) */
	editorTxMode?: string;
	/** Current grid page (data-grid tabs only) */
	gridPage?: number;
	/** Grid page size (data-grid tabs only) */
	gridPageSize?: number;
	/** Grid sort columns (data-grid tabs only) */
	gridSort?: SortColumn[];
	/** Grid column filters (data-grid tabs only) */
	gridFilters?: ColumnFilter[];
	/** Primary key values identifying the row (row-detail tabs only) */
	primaryKeys?: Record<string, unknown>;
}

/** Persisted layout state. */
export interface WorkspaceLayout {
	sidebarWidth: number;
	sidebarCollapsed: boolean;
}
