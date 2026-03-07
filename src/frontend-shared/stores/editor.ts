import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { generateChangesPreview, generateChangeSql } from '../../shared/sql/builders'
import { analyzeSelectSource } from '../../shared/sql/editability'
import { detectDestructiveWithoutWhere, isUnlimitedSelect, splitStatements } from '../../shared/sql/statements'
import type { ExplainResult, QueryEditability, QueryResult } from '../../shared/types/query'
import type { DataChange, TransactionLogEntry, TransactionLogStatus } from '../../shared/types/rpc'
import { friendlyErrorMessage, rpc } from '../lib/rpc'
import { getStatementAtCursor } from '../lib/sql-utils'
import { storage } from '../lib/storage'
import { createTabHelpers } from '../lib/tab-store-helpers'
import { scheduleWorkspaceSave } from '../lib/workspace'
import { connectionsStore } from './connections'
import type { CellChange, EditingCell } from './grid'
import { sessionStore } from './session'
import { settingsStore } from './settings'
import { uiStore } from './ui'

// ── Types ─────────────────────────────────────────────────

export type TxMode = 'auto-commit' | 'manual'

export interface PinnedResultSet {
	id: string
	results: QueryResult[]
	error: string | null
	duration: number
	explainResult: ExplainResult | null
	truncated: Record<number, boolean>
}

/** Pending changes for editable query results. */
export interface ResultPendingChanges {
	cellEdits: Record<string, CellChange>
}

export interface TabEditorState {
	connectionId: string
	database?: string
	content: string
	selectedText: string
	cursorPosition: number
	results: QueryResult[]
	isRunning: boolean
	error: string | null
	duration: number
	queryId: string | null
	txMode: TxMode
	inTransaction: boolean
	/** Range of the last executed statement (for visual flash feedback) */
	executedRange: { from: number; to: number } | null
	/** Error position in the editor (character offset, 0-based) for highlighting */
	errorOffset: number | null
	/** EXPLAIN plan result (when explain mode is used instead of run) */
	explainResult: ExplainResult | null
	/** Pinned result sets that are preserved across query executions */
	pinnedResults: PinnedResultSet[]
	/** Which result view is active: null = current results, string = pinned id */
	activeResultView: string | null
	/** The SQL that was last executed (needed for editability analysis) */
	lastExecutedSql: string | null
	/** Editability info for each result set (indexed by result index) */
	resultEditability: Record<number, QueryEditability>
	/** Mutable copy of rows for editing (keyed by result index) */
	resultRows: Record<number, Record<string, unknown>[]>
	/** Pending cell edits for result rows (keyed by result index) */
	resultPendingChanges: Record<number, ResultPendingChanges>
	/** Currently editing cell in result grid */
	resultEditingCell: EditingCell | null
	/** Which result index is being edited */
	resultEditingIndex: number | null
	/** Whether each result set was truncated by the auto-limit (keyed by result index) */
	resultTruncated: Record<number, boolean>
	/** Whether the AI prompt input is open */
	aiPromptOpen: boolean
	/** Whether AI generation is in progress */
	aiGenerating: boolean
	/** Error from AI generation */
	aiError: string | null
	/** PostgreSQL search_path override for this tab (null = server default) */
	searchPath: string | null
}

function createDefaultEditorState(connectionId: string, database?: string): TabEditorState {
	return {
		connectionId,
		database,
		content: '',
		selectedText: '',
		cursorPosition: 0,
		results: [],
		isRunning: false,
		error: null,
		duration: 0,
		queryId: null,
		txMode: 'auto-commit',
		inTransaction: false,
		executedRange: null,
		errorOffset: null,
		explainResult: null,
		pinnedResults: [],
		activeResultView: null,
		lastExecutedSql: null,
		resultEditability: {},
		resultRows: {},
		resultPendingChanges: {},
		resultEditingCell: null,
		resultEditingIndex: null,
		resultTruncated: {},
		aiPromptOpen: false,
		aiGenerating: false,
		aiError: null,
		searchPath: null,
	}
}

function createDefaultResultPendingChanges(): ResultPendingChanges {
	return { cellEdits: {} }
}

// ── Store ─────────────────────────────────────────────────

interface EditorStoreState {
	tabs: Record<string, TabEditorState>
}

const [state, setState] = createStore<EditorStoreState>({
	tabs: {},
})

/** Bumped after each query execution to trigger TransactionLog refresh. */
const [txLogVersion, setTxLogVersion] = createSignal(0)

// ── Destructive query confirmation ────────────────────────

export interface PendingDestructiveQuery {
	tabId: string
	sql: string
	baseOffset: number
	statements: string[]
}

const [pendingDestructiveQuery, setPendingDestructiveQuery] = createSignal<PendingDestructiveQuery | null>(null)
let suppressDestructiveWarning = false

/**
 * Check if any statements in the SQL are destructive (DELETE/UPDATE) without WHERE.
 * Returns the list of dangerous statements, or empty array if safe.
 */
function findDestructiveStatements(sql: string): string[] {
	const statements = splitStatements(sql)
	return statements.filter(detectDestructiveWithoutWhere)
}

const DML_PATTERN = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i

/**
 * Check if any statement in the SQL is a DML/DDL statement.
 */
function containsDmlStatements(sql: string): boolean {
	const statements = splitStatements(sql)
	return statements.some((s) => DML_PATTERN.test(s))
}

// ── Internal helpers ──────────────────────────────────────

const { getTab, ensureTab } = createTabHelpers(() => state.tabs, 'Editor')

// ── Actions ───────────────────────────────────────────────

function initTab(tabId: string, connectionId: string, database?: string) {
	const existing = getTab(tabId)
	if (!existing) {
		setState('tabs', tabId, createDefaultEditorState(connectionId, database))
	} else if (database !== undefined && existing.database !== database) {
		// Update database if the tab was previously initialized without it
		// (e.g., SqlEditor.onMount fires before the explicit initTab call)
		setState('tabs', tabId, 'database', database)
	}
}

function setContent(tabId: string, content: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'content', content)
	scheduleWorkspaceSave()
}

function setSelectedText(tabId: string, selectedText: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'selectedText', selectedText)
}

function setCursorPosition(tabId: string, position: number) {
	ensureTab(tabId)
	setState('tabs', tabId, 'cursorPosition', position)
}

function recordHistory(connectionId: string, database: string | undefined, sql: string, results: QueryResult[]) {
	const hasError = results.some((r) => r.error)
	const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
	const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount ?? 0), 0)
	storage.addHistoryEntry({
		connectionId,
		database,
		sql,
		status: hasError ? 'error' : 'success',
		durationMs: Math.round(totalDuration),
		rowCount: totalRows,
		errorMessage: results.find((r) => r.error)?.error,
		executedAt: new Date().toISOString(),
	}).catch((e) => {
		console.debug('Failed to record history:', e)
		uiStore.addToast('warning', 'Failed to save query history. Changes may not persist.')
	})
}

async function runQuery(tabId: string, sql: string, baseOffset = 0, applyLimit = true) {
	const tab = ensureTab(tabId)
	const queryId = crypto.randomUUID()

	setState('tabs', tabId, {
		isRunning: true,
		error: null,
		queryId,
		results: [],
		explainResult: null,
		duration: 0,
		errorOffset: null,
		activeResultView: null,
		lastExecutedSql: sql,
		resultEditability: {},
		resultRows: {},
		resultPendingChanges: {},
		resultEditingCell: null,
		resultEditingIndex: null,
		resultTruncated: {},
	})

	// Apply auto-limit to unlimited SELECT statements
	const limit = settingsStore.consoleConfig.defaultResultLimit
	let executeSql = sql
	const limitedStatementIndices = new Set<number>()

	if (applyLimit && limit > 0) {
		const statements = splitStatements(sql)
		const modified: string[] = []
		for (let i = 0; i < statements.length; i++) {
			if (isUnlimitedSelect(statements[i])) {
				modified.push(`${statements[i]} LIMIT ${limit + 1}`)
				limitedStatementIndices.add(i)
			} else {
				modified.push(statements[i])
			}
		}
		executeSql = modified.join(';\n')
	}

	const startTime = performance.now()

	try {
		// Resolve session (auto-pin if configured)
		const sessionId = await sessionStore.resolveSessionForExecution(tabId, tab.connectionId, sql, tab.database)
		const results = await rpc.query.execute({ connectionId: tab.connectionId, sql: executeSql, queryId, database: tab.database, sessionId, searchPath: tab.searchPath ?? undefined })

		// Discard stale results if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return

		const duration = Math.round(performance.now() - startTime)

		// Detect and apply truncation for auto-limited results
		const truncated: Record<number, boolean> = {}
		for (let i = 0; i < results.length; i++) {
			if (limitedStatementIndices.has(i) && results[i].rows.length > limit) {
				results[i] = {
					...results[i],
					rows: results[i].rows.slice(0, limit),
					rowCount: limit,
				}
				truncated[i] = true
			}
		}

		// Extract error position from the first result that has an error
		const errorResult = results.find((r) => r.error && r.errorPosition)
		const errorOffset = errorResult?.errorPosition?.offset != null
			? baseOffset + errorResult.errorPosition.offset - 1 // Convert 1-based to 0-based
			: null

		setState('tabs', tabId, {
			results,
			duration,
			isRunning: false,
			error: null,
			queryId: null,
			errorOffset,
			resultTruncated: truncated,
		})

		// Compute editability using original SQL (not the modified one)
		computeResultEditability(tabId, sql, results)

		recordHistory(tab.connectionId, tab.database, sql, results)
		setTxLogVersion((v) => v + 1)

		// Auto-unpin after commit/rollback if configured
		sessionStore.checkAutoUnpin(tabId, sql).catch(() => {})
	} catch (err) {
		// Discard stale errors if a newer query was started
		if (state.tabs[tabId]?.queryId !== queryId) return

		const duration = Math.round(performance.now() - startTime)
		const errorMessage = friendlyErrorMessage(err)

		setState('tabs', tabId, {
			error: errorMessage,
			duration,
			isRunning: false,
			queryId: null,
			errorOffset: null,
		})

		recordHistory(tab.connectionId, tab.database, sql, [{
			columns: [],
			rows: [],
			rowCount: 0,
			durationMs: duration,
			error: errorMessage,
		}])
		setTxLogVersion((v) => v + 1)
	}
}

function checkAndRunQuery(tabId: string, sql: string, baseOffset = 0) {
	const tab = getTab(tabId)
	if (tab && connectionsStore.isReadOnly(tab.connectionId) && containsDmlStatements(sql)) {
		uiStore.addToast('warning', 'This connection is read-only. DML/DDL statements are not allowed.')
		return
	}
	if (!suppressDestructiveWarning) {
		const dangerous = findDestructiveStatements(sql)
		if (dangerous.length > 0) {
			setPendingDestructiveQuery({ tabId, sql, baseOffset, statements: dangerous })
			return
		}
	}
	runQuery(tabId, sql, baseOffset)
}

async function executeQuery(tabId: string) {
	const tab = ensureTab(tabId)
	const sql = tab.content.trim()
	if (!sql) return

	// Base offset accounts for leading whitespace stripped by trim()
	const baseOffset = tab.content.length - tab.content.trimStart().length
	checkAndRunQuery(tabId, sql, baseOffset)
}

async function executeSelected(tabId: string, selectedText: string) {
	ensureTab(tabId)
	const sql = selectedText.trim()
	if (!sql) return

	checkAndRunQuery(tabId, sql)
}

async function executeStatement(tabId: string) {
	const tab = ensureTab(tabId)
	// If text is selected, run that; otherwise detect statement at cursor
	if (tab.selectedText.trim()) {
		checkAndRunQuery(tabId, tab.selectedText.trim())
		return
	}
	const result = getStatementAtCursor(tab.content, tab.cursorPosition)
	if (result) {
		setState('tabs', tabId, 'executedRange', { from: result.from, to: result.to })
		checkAndRunQuery(tabId, result.text, result.from)
	}
}

function confirmDestructiveQuery(suppressForSession = false) {
	const pending = pendingDestructiveQuery()
	if (!pending) return
	if (suppressForSession) {
		suppressDestructiveWarning = true
	}
	setPendingDestructiveQuery(null)
	runQuery(pending.tabId, pending.sql, pending.baseOffset)
}

function cancelDestructiveQuery() {
	setPendingDestructiveQuery(null)
}

async function cancelQuery(tabId: string) {
	const tab = ensureTab(tabId)
	if (!tab.isRunning || !tab.queryId) return

	try {
		await rpc.query.cancel({ queryId: tab.queryId })
	} catch (err) {
		console.debug('Query cancellation failed:', err instanceof Error ? err.message : err)
	}
}

async function formatSql(tabId: string) {
	const tab = ensureTab(tabId)
	if (!tab.content.trim()) return

	try {
		const result = await rpc.query.format({ sql: tab.content })
		setState('tabs', tabId, 'content', result.sql)
	} catch (err) {
		console.debug('SQL format failed:', err instanceof Error ? err.message : err)
	}
}

function setSearchPath(tabId: string, searchPath: string | null) {
	ensureTab(tabId)
	setState('tabs', tabId, 'searchPath', searchPath)
	scheduleWorkspaceSave()
}

function setTxMode(tabId: string, mode: TxMode) {
	ensureTab(tabId)
	setState('tabs', tabId, 'txMode', mode)
	scheduleWorkspaceSave()
}

async function beginTransaction(tabId: string) {
	const tab = ensureTab(tabId)
	const sessionId = sessionStore.getSessionForTab(tabId)
	try {
		await rpc.tx.begin({ connectionId: tab.connectionId, database: tab.database, sessionId })
		setState('tabs', tabId, 'inTransaction', true)
	} catch (err) {
		setState('tabs', tabId, 'error', friendlyErrorMessage(err))
	}
}

async function commitTransaction(tabId: string) {
	const tab = ensureTab(tabId)
	if (!tab.inTransaction) return

	const sessionId = sessionStore.getSessionForTab(tabId)
	try {
		await rpc.tx.commit({ connectionId: tab.connectionId, database: tab.database, sessionId })
		setState('tabs', tabId, 'inTransaction', false)
		// Auto-unpin after commit if configured
		sessionStore.checkAutoUnpin(tabId, 'COMMIT').catch(() => {})
	} catch (err) {
		setState('tabs', tabId, 'error', friendlyErrorMessage(err))
	}
}

async function rollbackTransaction(tabId: string) {
	const tab = ensureTab(tabId)
	if (!tab.inTransaction) return

	const sessionId = sessionStore.getSessionForTab(tabId)
	try {
		await rpc.tx.rollback({ connectionId: tab.connectionId, database: tab.database, sessionId })
		setState('tabs', tabId, 'inTransaction', false)
		// Auto-unpin after rollback if configured
		sessionStore.checkAutoUnpin(tabId, 'ROLLBACK').catch(() => {})
	} catch (err) {
		setState('tabs', tabId, 'error', friendlyErrorMessage(err))
	}
}

async function explainQuery(tabId: string, analyze = false) {
	const tab = ensureTab(tabId)
	let sql = tab.selectedText.trim()
	if (!sql) {
		const result = getStatementAtCursor(tab.content, tab.cursorPosition)
		sql = result?.text ?? tab.content.trim()
	}
	if (!sql) return

	setState('tabs', tabId, {
		isRunning: true,
		error: null,
		results: [],
		explainResult: null,
		duration: 0,
		errorOffset: null,
		activeResultView: null,
	})

	try {
		const sessionId = sessionStore.getSessionForTab(tabId)
		const explainResult = await rpc.query.explain({
			connectionId: tab.connectionId,
			sql,
			analyze,
			database: tab.database,
			sessionId,
			searchPath: tab.searchPath ?? undefined,
		})

		setState('tabs', tabId, {
			explainResult,
			duration: explainResult.durationMs,
			isRunning: false,
			error: explainResult.error ?? null,
		})
	} catch (err) {
		const errorMessage = friendlyErrorMessage(err)
		setState('tabs', tabId, {
			error: errorMessage,
			isRunning: false,
			explainResult: null,
		})
	}
}

async function fetchAllResults(tabId: string) {
	const tab = ensureTab(tabId)
	const sql = tab.lastExecutedSql
	if (!sql) return
	await runQuery(tabId, sql, 0, false)
}

function pinCurrentResult(tabId: string) {
	const tab = ensureTab(tabId)
	if (tab.results.length === 0 && !tab.error && !tab.explainResult) return

	const pinned: PinnedResultSet = {
		id: crypto.randomUUID(),
		results: tab.results,
		error: tab.error,
		duration: tab.duration,
		explainResult: tab.explainResult,
		truncated: { ...tab.resultTruncated },
	}

	setState('tabs', tabId, 'pinnedResults', [...tab.pinnedResults, pinned])
	setState('tabs', tabId, 'activeResultView', pinned.id)
	// Clear current results so the next query goes into a fresh tab
	setState('tabs', tabId, {
		results: [],
		error: null,
		duration: 0,
		explainResult: null,
		errorOffset: null,
	})
}

function unpinResult(tabId: string, pinnedId: string) {
	const tab = ensureTab(tabId)
	setState('tabs', tabId, 'pinnedResults', tab.pinnedResults.filter((p) => p.id !== pinnedId))
	if (tab.activeResultView === pinnedId) {
		setState('tabs', tabId, 'activeResultView', null)
	}
}

function setActiveResultView(tabId: string, view: string | null) {
	ensureTab(tabId)
	setState('tabs', tabId, 'activeResultView', view)
}

function removeTab(tabId: string) {
	setState('tabs', tabId, undefined!)
}

/** Reset transaction state for all editor tabs on a given connection. */
function resetTransactionStateForConnection(connectionId: string) {
	for (const [tabId, tab] of Object.entries(state.tabs)) {
		if (tab.connectionId === connectionId && tab.inTransaction) {
			setState('tabs', tabId, 'inTransaction', false)
		}
	}
}

// ── Result editability ────────────────────────────────────

/**
 * Compute editability for query results using SQL analysis and schema metadata.
 * Called after query execution completes.
 */
function computeResultEditability(tabId: string, sql: string, results: QueryResult[]) {
	const tab = getTab(tabId)
	if (!tab) return

	// Split into statements to analyze each one individually
	const statements = splitStatements(sql)
	const editability: Record<number, QueryEditability> = {}
	const resultRows: Record<number, Record<string, unknown>[]> = {}

	for (let i = 0; i < results.length; i++) {
		const result = results[i]
		// Only analyze results with columns (SELECT results, not DML)
		if (!result.columns.length || result.error) continue

		const stmt = statements[i] ?? sql
		const analysis = analyzeSelectSource(stmt)

		if (!analysis.editable) {
			editability[i] = { editable: false, reason: analysis.reason }
			continue
		}

		const source = analysis.source

		// Look up the table in the connection's schema cache
		const schema = source.schema ?? getDefaultSchema(tab.connectionId)
		const columns = connectionsStore.getColumns(tab.connectionId, schema, source.table, tab.database)

		if (columns.length === 0) {
			editability[i] = { editable: false, reason: 'unknown_table' }
			continue
		}

		// Find PK columns
		const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
		if (pkColumns.length === 0) {
			editability[i] = { editable: false, reason: 'no_pk' }
			continue
		}

		// Check if PK columns are in the result set
		const resultColumnNames = new Set(result.columns.map((c) => c.name))
		const missingPks = pkColumns.filter((pk) => !resultColumnNames.has(pk))
		if (missingPks.length > 0) {
			editability[i] = { editable: false, reason: 'no_pk' }
			continue
		}

		// Determine which result columns map to table columns (those are editable)
		const tableColumnNames = new Set(columns.map((c) => c.name))
		const editableColumns = result.columns
			.map((c) => c.name)
			.filter((name) => tableColumnNames.has(name))

		editability[i] = {
			editable: true,
			schema,
			table: source.table,
			primaryKeys: pkColumns,
			editableColumns,
		}

		// Create mutable copy of rows
		resultRows[i] = result.rows.map((row) => ({ ...row }))
	}

	setState('tabs', tabId, 'resultEditability', editability)
	setState('tabs', tabId, 'resultRows', resultRows)
}

/**
 * Get the default schema for a connection based on its type.
 */
function getDefaultSchema(connectionId: string): string {
	const connType = connectionsStore.getConnectionType(connectionId)
	if (connType === 'sqlite') return 'main'
	return 'public' // PostgreSQL default
}

// ── Result editing actions ────────────────────────────────

function startResultEditing(tabId: string, resultIndex: number, row: number, column: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'resultEditingCell', { row, column })
	setState('tabs', tabId, 'resultEditingIndex', resultIndex)
}

function stopResultEditing(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, 'resultEditingCell', null)
}

function setResultCellValue(tabId: string, resultIndex: number, rowIndex: number, column: string, newValue: unknown) {
	const tab = ensureTab(tabId)
	const rows = tab.resultRows[resultIndex]
	if (!rows) return

	const key = `${rowIndex}:${column}`
	const pending = tab.resultPendingChanges[resultIndex] ?? createDefaultResultPendingChanges()
	const existing = pending.cellEdits[key]
	const oldValue = existing ? existing.oldValue : tab.results[resultIndex]?.rows[rowIndex]?.[column]

	if (oldValue === newValue) {
		// Reverting to original: remove the edit
		const next = { ...pending.cellEdits }
		delete next[key]
		if (!tab.resultPendingChanges[resultIndex]) {
			setState('tabs', tabId, 'resultPendingChanges', resultIndex, { cellEdits: next })
		} else {
			setState('tabs', tabId, 'resultPendingChanges', resultIndex, 'cellEdits', next)
		}
	} else {
		if (!tab.resultPendingChanges[resultIndex]) {
			setState('tabs', tabId, 'resultPendingChanges', resultIndex, {
				cellEdits: { [key]: { rowIndex, column, oldValue, newValue } },
			})
		} else {
			setState('tabs', tabId, 'resultPendingChanges', resultIndex, 'cellEdits', key, {
				rowIndex,
				column,
				oldValue,
				newValue,
			})
		}
	}

	// Update mutable row for display
	setState('tabs', tabId, 'resultRows', resultIndex, rowIndex, column, newValue)
}

function hasResultPendingChanges(tabId: string, resultIndex: number): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return false
	return Object.keys(pending.cellEdits).length > 0
}

function hasAnyResultPendingChanges(tabId: string): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	for (const pending of Object.values(tab.resultPendingChanges)) {
		if (Object.keys(pending.cellEdits).length > 0) return true
	}
	return false
}

function resultPendingChangesCount(tabId: string, resultIndex: number): number {
	const tab = getTab(tabId)
	if (!tab) return 0
	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return 0
	// Count distinct rows with changes
	const rows = new Set<number>()
	for (const edit of Object.values(pending.cellEdits)) {
		rows.add(edit.rowIndex)
	}
	return rows.size
}

function isResultCellChanged(tabId: string, resultIndex: number, rowIndex: number, column: string): boolean {
	const tab = getTab(tabId)
	if (!tab) return false
	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return false
	return `${rowIndex}:${column}` in pending.cellEdits
}

function buildResultDataChanges(tabId: string, resultIndex: number): DataChange[] {
	const tab = ensureTab(tabId)
	const editability = tab.resultEditability[resultIndex]
	if (!editability?.editable) return []

	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return []

	const pkColumns = editability.primaryKeys!
	const changes: DataChange[] = []

	// Group cell edits by row
	const editsByRow = new Map<number, Record<string, unknown>>()
	for (const edit of Object.values(pending.cellEdits)) {
		let rowEdits = editsByRow.get(edit.rowIndex)
		if (!rowEdits) {
			rowEdits = {}
			editsByRow.set(edit.rowIndex, rowEdits)
		}
		rowEdits[edit.column] = edit.newValue
	}

	for (const [rowIndex, values] of editsByRow) {
		// Use original row data for PK values
		const originalRow = tab.results[resultIndex]?.rows[rowIndex]
		if (!originalRow) continue

		const primaryKeys: Record<string, unknown> = {}
		for (const pk of pkColumns) {
			// If PK was edited, use the original value
			const pkEdit = pending.cellEdits[`${rowIndex}:${pk}`]
			primaryKeys[pk] = pkEdit ? pkEdit.oldValue : originalRow[pk]
		}

		changes.push({
			type: 'update',
			schema: editability.schema!,
			table: editability.table!,
			primaryKeys,
			values,
		})
	}

	return changes
}

async function applyResultChanges(tabId: string, resultIndex: number) {
	const tab = ensureTab(tabId)
	const changes = buildResultDataChanges(tabId, resultIndex)
	if (changes.length === 0) return

	const dialect = connectionsStore.getDialect(tab.connectionId)
	const statements = changes.map((change) => generateChangeSql(change, dialect))
	const sessionId = sessionStore.getSessionForTab(tabId)
	await rpc.query.execute({ connectionId: tab.connectionId, sql: '', queryId: '', statements, database: tab.database, sessionId })
}

function generateResultSqlPreview(tabId: string, resultIndex: number): string {
	const tab = ensureTab(tabId)
	const changes = buildResultDataChanges(tabId, resultIndex)
	if (changes.length === 0) return ''
	const dialect = connectionsStore.getDialect(tab.connectionId)
	return generateChangesPreview(changes, dialect)
}

function revertResultChanges(tabId: string, resultIndex: number) {
	const tab = ensureTab(tabId)
	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return

	// Restore original values in mutable rows
	for (const edit of Object.values(pending.cellEdits)) {
		setState('tabs', tabId, 'resultRows', resultIndex, edit.rowIndex, edit.column, edit.oldValue)
	}

	setState('tabs', tabId, 'resultPendingChanges', resultIndex, createDefaultResultPendingChanges())
	setState('tabs', tabId, 'resultEditingCell', null)
}

function clearResultPendingChanges(tabId: string, resultIndex: number) {
	ensureTab(tabId)
	setState('tabs', tabId, 'resultPendingChanges', resultIndex, createDefaultResultPendingChanges())
	setState('tabs', tabId, 'resultEditingCell', null)
}

function revertResultRowUpdate(tabId: string, resultIndex: number, rowIndex: number) {
	const tab = ensureTab(tabId)
	const pending = tab.resultPendingChanges[resultIndex]
	if (!pending) return

	const edits = { ...pending.cellEdits }
	for (const [key, edit] of Object.entries(edits)) {
		if (edit.rowIndex === rowIndex) {
			setState('tabs', tabId, 'resultRows', resultIndex, rowIndex, edit.column, edit.oldValue)
			delete edits[key]
		}
	}
	setState('tabs', tabId, 'resultPendingChanges', resultIndex, 'cellEdits', edits)
}

// ── Transaction Log ───────────────────────────────────────

export interface TransactionLogState {
	entries: TransactionLogEntry[]
	pendingStatementCount: number
	statusFilter: TransactionLogStatus | undefined
	search: string
	selectedEntryId: string | null
}

const [txLogState, setTxLogState] = createStore<TransactionLogState>({
	entries: [],
	pendingStatementCount: 0,
	statusFilter: undefined,
	search: '',
	selectedEntryId: null,
})

async function fetchTransactionLog(connectionId: string, database?: string, sessionId?: string) {
	try {
		const result = await rpc.transaction.getLog({
			connectionId,
			database,
			sessionId,
			statusFilter: txLogState.statusFilter,
			search: txLogState.search || undefined,
		})
		setTxLogState({
			entries: result.entries,
			pendingStatementCount: result.pendingStatementCount,
		})
	} catch (err) {
		console.debug('Failed to fetch transaction log:', err instanceof Error ? err.message : err)
	}
}

function setTxLogStatusFilter(filter: TransactionLogStatus | undefined) {
	setTxLogState('statusFilter', filter)
}

function setTxLogSearch(search: string) {
	setTxLogState('search', search)
}

function setTxLogSelectedEntry(id: string | null) {
	setTxLogState('selectedEntryId', id)
}

async function clearTransactionLog(connectionId: string, database?: string) {
	try {
		await rpc.transaction.clearLog({ connectionId, database })
		setTxLogState({ entries: [], pendingStatementCount: 0, selectedEntryId: null })
	} catch (err) {
		console.debug('Failed to clear transaction log:', err instanceof Error ? err.message : err)
	}
}

/** Get the pending TX statement count for the status bar. */
function getPendingTxCount(connectionId: string): number {
	// Check if any editor tab on this connection is in a transaction
	for (const [, tab] of Object.entries(state.tabs)) {
		if (tab.connectionId === connectionId && tab.inTransaction) {
			return txLogState.pendingStatementCount
		}
	}
	return 0
}

// ── AI SQL generation ─────────────────────────────────────

function openAiPrompt(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, { aiPromptOpen: true, aiError: null })
}

function closeAiPrompt(tabId: string) {
	ensureTab(tabId)
	setState('tabs', tabId, { aiPromptOpen: false, aiGenerating: false, aiError: null })
}

function toggleAiPrompt(tabId: string) {
	const tab = ensureTab(tabId)
	if (tab.aiPromptOpen) {
		closeAiPrompt(tabId)
	} else {
		openAiPrompt(tabId)
	}
}

async function generateAiSql(tabId: string, prompt: string) {
	const tab = ensureTab(tabId)
	if (!prompt.trim()) return

	setState('tabs', tabId, { aiGenerating: true, aiError: null })

	try {
		const result = await rpc.ai.generateSql({
			connectionId: tab.connectionId,
			database: tab.database,
			prompt: prompt.trim(),
		})

		// Insert generated SQL into editor
		const currentContent = tab.content
		if (currentContent.trim()) {
			// Append after existing content with a blank line separator
			setState('tabs', tabId, 'content', currentContent.trimEnd() + '\n\n' + result.sql)
		} else {
			setState('tabs', tabId, 'content', result.sql)
		}

		setState('tabs', tabId, { aiGenerating: false, aiPromptOpen: false, aiError: null })
	} catch (err) {
		const errorMessage = friendlyErrorMessage(err)
		setState('tabs', tabId, { aiGenerating: false, aiError: errorMessage })
	}
}

// ── Export ─────────────────────────────────────────────────

export const editorStore = {
	getTab,
	initTab,
	setContent,
	setSelectedText,
	setCursorPosition,
	executeQuery,
	executeSelected,
	executeStatement,
	cancelQuery,
	explainQuery,
	formatSql,
	setSearchPath,
	setTxMode,
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	removeTab,
	resetTransactionStateForConnection,
	pinCurrentResult,
	unpinResult,
	setActiveResultView,
	fetchAllResults,
	get pendingDestructiveQuery() {
		return pendingDestructiveQuery()
	},
	confirmDestructiveQuery,
	cancelDestructiveQuery,
	// Result editing
	startResultEditing,
	stopResultEditing,
	setResultCellValue,
	hasResultPendingChanges,
	hasAnyResultPendingChanges,
	resultPendingChangesCount,
	isResultCellChanged,
	buildResultDataChanges,
	applyResultChanges,
	generateResultSqlPreview,
	revertResultChanges,
	clearResultPendingChanges,
	revertResultRowUpdate,
	// Transaction log
	get txLogState() {
		return txLogState
	},
	get txLogVersion() {
		return txLogVersion()
	},
	fetchTransactionLog,
	setTxLogStatusFilter,
	setTxLogSearch,
	setTxLogSelectedEntry,
	clearTransactionLog,
	getPendingTxCount,
	// AI SQL generation
	openAiPrompt,
	closeAiPrompt,
	toggleAiPrompt,
	generateAiSql,
}
