import type { TransactionLogEntry, TransactionLogStatus } from '@dotaz/shared/types/rpc'
import { createStore } from 'solid-js/store'
import { rpc } from '../lib/rpc'
import type { EditorStoreState } from './editor'

export interface TransactionLogState {
	entries: TransactionLogEntry[]
	pendingStatementCount: number
	statusFilter: TransactionLogStatus | undefined
	search: string
	selectedEntryId: string | null
}

export const [txLogState, setTxLogState] = createStore<TransactionLogState>({
	entries: [],
	pendingStatementCount: 0,
	statusFilter: undefined,
	search: '',
	selectedEntryId: null,
})

export async function fetchTransactionLog(connectionId: string, database?: string, sessionId?: string) {
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

export function setTxLogStatusFilter(filter: TransactionLogStatus | undefined) {
	setTxLogState('statusFilter', filter)
}

export function setTxLogSearch(search: string) {
	setTxLogState('search', search)
}

export function setTxLogSelectedEntry(id: string | null) {
	setTxLogState('selectedEntryId', id)
}

export async function clearTransactionLog(connectionId: string, database?: string) {
	try {
		await rpc.transaction.clearLog({ connectionId, database })
		setTxLogState({ entries: [], pendingStatementCount: 0, selectedEntryId: null })
	} catch (err) {
		console.debug('Failed to clear transaction log:', err instanceof Error ? err.message : err)
	}
}

export function createTxLogHelpers(state: EditorStoreState) {
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
	return { getPendingTxCount }
}
