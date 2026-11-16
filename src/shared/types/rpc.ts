import type { ConnectionType } from './connection'
import type { ColumnFilter, FilterOperator, SortColumn } from './grid'

// ---- Session types ----

export interface SessionInfo {
	sessionId: string
	connectionId: string
	database?: string
	label: string
	inTransaction: boolean
	txAborted: boolean
	createdAt: number
	/** Session is read-only at the engine level — set for agent/CLI sessions. */
	readOnly?: boolean
}

// ---- Agent CLI types (see docs/agent-cli.md) ----

export type ProposalStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'executed'
	| 'failed'
	| 'cancelled'
	| 'expired'

/**
 * A write submitted by the CLI for the user to approve in the app.
 * The CLI never executes writes itself.
 */
export interface Proposal {
	id: string
	connectionId: string
	/** The connection's name when the proposal was made. Part of what a remote approver signs. */
	connectionName: string
	database?: string
	/** Frozen at creation: this exact string is what gets shown, signed and run. */
	sql: string
	reason?: string
	/** Free-text label of whoever asked, as the CLI reported it. Unverified. */
	requestedBy?: string
	status: ProposalStatus
	createdAt: number
	resolvedAt?: number
	/** Where the decision was made: the app's own window, or a remote approval with a paired key. */
	resolvedVia?: 'app' | 'remote'
	/** Label of the paired key that approved or rejected remotely. */
	approver?: string
	result?: { affectedRows?: number; statements?: number }
	error?: string
}

export interface ProposeWriteParams {
	connectionId: string
	database?: string
	sql: string
	reason?: string
	requestedBy?: string
}

// ---- Remote approvals (see docs/agent-cli.md) ----

/** A passkey allowed to approve proposals from a paired device. Public data only. */
export interface RemoteApprover {
	id: string
	label: string
	rpId: string
	origin: string
	/** base64url */
	credentialId: string
	/** 16 base32 characters, see `approverFingerprint()` */
	fingerprint: string
	addedAt: number
}

/** What a device sends to ask to be paired. The user confirms it in the app's window. */
export interface ApproverRequestParams {
	label: string
	rpId: string
	origin: string
	/** base64url */
	credentialId: string
	/** base64url COSE_Key, ES256 on P-256 */
	publicKey: string
}

export interface ApproverRequestResult {
	requestId: string
	fingerprint: string
	expiresAt: number
}

/** A pairing request waiting for the user's decision in the app's window. */
export interface ApproverRequest {
	requestId: string
	label: string
	rpId: string
	origin: string
	credentialId: string
	fingerprint: string
	requestedAt: number
	expiresAt: number
}

/** Pushed to the frontend on `approvers.changed`. */
export interface ApproversState {
	request: ApproverRequest | null
	approvers: RemoteApprover[]
}

export type ApprovalDecision = 'approve' | 'reject'

export interface ApprovalChallengeParams {
	proposalId: string
	decision: ApprovalDecision
}

export interface ApprovalChallenge {
	/** base64url, 32 random bytes. Good for one redeem attempt. */
	nonce: string
	expiresAt: number
	proposal: {
		id: string
		connectionId: string
		connectionName: string
		database: string | null
		sql: string
		/** Lowercase hex SHA-256 over the UTF-8 bytes of `sql`. */
		sqlSha256: string
		reason: string | null
		requestedBy: string | null
		createdAt: number
		statements: number
	}
	/** base64url credential ids of the paired keys. */
	allowCredentials: string[]
}

/** All binary fields base64url, as the browser's `PublicKeyCredential` returned them. */
export interface ApprovalRedeemParams {
	proposalId: string
	decision: ApprovalDecision
	nonce: string
	credentialId: string
	authenticatorData: string
	clientDataJSON: string
	signature: string
}

export interface ProposalListParams {
	status?: ProposalStatus
	connectionId?: string
}

export interface ProposalResolveParams {
	proposalId: string
	status: ProposalStatus
	result?: { affectedRows?: number; statements?: number }
	error?: string
}

export interface AgentHelloResult {
	version: string
	mode: 'desktop' | 'web' | 'demo'
	pid: number
	protocol: number
}

export interface AgentQueryParams {
	connectionId: string
	database?: string
	sql: string
	queryId: string
	params?: unknown[]
	searchPath?: string
}

export interface AgentSchemaParams {
	connectionId: string
	database?: string
}

export type AgentSearchParams = Omit<SearchDatabaseParams, 'sessionId'>

/** One open tab, as reported to the CLI by `ui.state`. */
export interface UiTabSnapshot {
	id: string
	type: string
	title: string
	connectionId: string
	database?: string
	schema?: string
	table?: string
	/** Current editor contents — SQL console tabs only. */
	sql?: string
}

export interface UiSnapshot {
	tabs: UiTabSnapshot[]
	activeTabId: string | null
	activeConnectionId: string | null
	updatedAt: number
}

export type UiCommandPayload =
	| { kind: 'open-table'; connectionId: string; database?: string; schema: string; table: string; where?: string; limit?: number }
	| { kind: 'open-console'; connectionId: string; database?: string; sql?: string }

// ---- Open connection handle diagnostics ----

export type ConnectionHandleRole =
	| 'system'
	| 'idle'
	| 'temporary'
	| 'session'
	| 'default-transaction'
	| 'sqlite-main'
	| 'sqlite-iterate'

export type ConnectionHandleState = 'idle' | 'active' | 'transaction'

export interface DriverConnectionHandleInfo {
	handleId: string
	role: ConnectionHandleRole
	state: ConnectionHandleState
	label?: string
	sessionId?: string
	createdAt: number
	lastUsedAt: number
	activeQueryCount: number
	inTransaction: boolean
	txAborted: boolean
	iterating: boolean
	canTerminate: boolean
}

export interface ConnectionHandleInfo extends DriverConnectionHandleInfo {
	connectionId: string
	connectionName: string
	database: string
	driverType: ConnectionType
}

// ---- Domain types used by handlers and adapters ----

interface DataChangeBase {
	schema: string
	table: string
}

export interface InsertChange extends DataChangeBase {
	type: 'insert'
	/** Column values for the new row. Empty/undefined means DEFAULT VALUES. */
	values?: Record<string, unknown>
}

export interface UpdateChange extends DataChangeBase {
	type: 'update'
	/** Primary key values identifying the row to update. */
	primaryKeys: Record<string, unknown>
	/** Column values to set. */
	values: Record<string, unknown>
}

export interface DeleteChange extends DataChangeBase {
	type: 'delete'
	/** Primary key values identifying the row to delete. */
	primaryKeys: Record<string, unknown>
}

export type DataChange = InsertChange | UpdateChange | DeleteChange

export interface HistoryListParams {
	connectionId?: string
	limit?: number
	offset?: number
	search?: string
	/** ISO date string (YYYY-MM-DD) — inclusive lower bound on executed_at */
	startDate?: string
	/** ISO date string (YYYY-MM-DD) — inclusive upper bound on executed_at */
	endDate?: string
}

export interface RowColorRule {
	column: string
	operator: FilterOperator
	value: unknown
	color: string
}

export interface SavedViewConfig {
	columns?: string[]
	sort?: SortColumn[]
	filters?: ColumnFilter[]
	columnWidths?: Record<string, number>
	customFilter?: string
	rowColorRules?: RowColorRule[]
	autoJoins?: import('./grid').AutoJoinDef[]
}

export interface SavedView {
	id: string
	connectionId: string
	schemaName: string
	tableName: string
	name: string
	config: SavedViewConfig
	createdAt: string
	updatedAt: string
}

export interface QueryBookmark {
	id: string
	connectionId: string
	database?: string
	name: string
	description: string
	sql: string
	createdAt: string
	updatedAt: string
}

// ---- Database search types ----

export type SearchScope = 'database' | 'schema' | 'tables'

export interface SearchDatabaseParams {
	connectionId: string
	database?: string
	sessionId?: string
	searchTerm: string
	scope: SearchScope
	schemaName?: string
	tableNames?: string[]
	resultsPerTable?: number
}

export interface SearchMatch {
	schema: string
	table: string
	column: string
	row: Record<string, unknown>
}

export interface SearchDatabaseResult {
	matches: SearchMatch[]
	searchedTables: number
	totalMatches: number
	cancelled: boolean
	elapsedMs: number
}

// ---- Transaction log types ----

export type TransactionLogStatus = 'success' | 'error'

export interface TransactionLogEntry {
	id: string
	sql: string
	status: TransactionLogStatus
	durationMs: number
	rowCount: number
	errorMessage?: string
	executedAt: string
}

export interface TransactionLogParams {
	connectionId: string
	database?: string
	sessionId?: string
	statusFilter?: TransactionLogStatus
	search?: string
}

export interface TransactionLogResult {
	entries: TransactionLogEntry[]
	pendingStatementCount: number
	inTransaction: boolean
}

// ---- AI SQL generation types ----

export interface AiGenerateSqlParams {
	connectionId: string
	database?: string
	prompt: string
}

export interface AiGenerateSqlResult {
	sql: string
}

export interface OpenDialogParams {
	title?: string
	filters?: { name: string; extensions: string[] }[]
	multiple?: boolean
}

export interface SaveDialogParams {
	title?: string
	defaultName?: string
	filters?: { name: string; extensions: string[] }[]
}
