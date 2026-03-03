import Trash2 from 'lucide-solid/icons/trash-2'
import { createEffect, For, Show } from 'solid-js'
import type { TransactionLogEntry, TransactionLogStatus } from '../../../shared/types/rpc'
import { editorStore } from '../../stores/editor'
import './TransactionLog.css'

interface TransactionLogProps {
	connectionId: string
	database?: string
}

function formatTime(isoDate: string): string {
	try {
		const d = new Date(isoDate)
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
	} catch {
		return isoDate
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

function truncateSql(sql: string, max = 120): string {
	const oneLine = sql.replace(/\s+/g, ' ').trim()
	return oneLine.length > max ? oneLine.substring(0, max) + '...' : oneLine
}

export default function TransactionLog(props: TransactionLogProps) {
	const logState = () => editorStore.txLogState
	const entries = () => logState().entries
	const selectedId = () => logState().selectedEntryId
	const statusFilter = () => logState().statusFilter
	const search = () => logState().search

	// Fetch log entries when the component is visible, and whenever filter/search changes
	createEffect(() => {
		// Access reactive deps to re-fetch when they change
		statusFilter()
		search()
		editorStore.txLogVersion // Re-fetch after query execution
		editorStore.fetchTransactionLog(props.connectionId, props.database)
	})

	function handleStatusFilter(filter: TransactionLogStatus | undefined) {
		editorStore.setTxLogStatusFilter(filter)
	}

	function handleSearch(value: string) {
		editorStore.setTxLogSearch(value)
	}

	function handleSelectEntry(id: string) {
		editorStore.setTxLogSelectedEntry(selectedId() === id ? null : id)
	}

	function handleClear() {
		editorStore.clearTransactionLog(props.connectionId, props.database)
	}

	const selectedEntry = (): TransactionLogEntry | undefined => {
		const id = selectedId()
		if (!id) return undefined
		return entries().find((e) => e.id === id)
	}

	return (
		<div class="tx-log">
			<div class="tx-log__toolbar">
				<input
					class="tx-log__search"
					type="text"
					placeholder="Search SQL..."
					value={search()}
					onInput={(e) => handleSearch(e.currentTarget.value)}
				/>
				<button
					class="tx-log__filter-btn"
					classList={{ 'tx-log__filter-btn--active': statusFilter() === undefined }}
					onClick={() => handleStatusFilter(undefined)}
				>
					All
				</button>
				<button
					class="tx-log__filter-btn"
					classList={{ 'tx-log__filter-btn--active': statusFilter() === 'success' }}
					onClick={() => handleStatusFilter('success')}
				>
					Success
				</button>
				<button
					class="tx-log__filter-btn"
					classList={{ 'tx-log__filter-btn--active': statusFilter() === 'error' }}
					onClick={() => handleStatusFilter('error')}
				>
					Error
				</button>
				<button
					class="tx-log__clear-btn"
					onClick={handleClear}
					title="Clear session log"
				>
					<Trash2 size={10} /> Clear
				</button>
			</div>

			<div class="tx-log__list">
				<Show when={entries().length > 0} fallback={<div class="tx-log__empty">No statements executed in this session</div>}>
					<For each={entries()}>
						{(entry) => (
							<div
								class="tx-log__entry"
								classList={{
									'tx-log__entry--selected': selectedId() === entry.id,
									'tx-log__entry--error': entry.status === 'error',
								}}
								onClick={() => handleSelectEntry(entry.id)}
							>
								<span
									class="tx-log__entry-status"
									classList={{
										'tx-log__entry-status--success': entry.status === 'success',
										'tx-log__entry-status--error': entry.status === 'error',
									}}
								/>
								<span class="tx-log__entry-sql" title={entry.sql}>
									{truncateSql(entry.sql)}
								</span>
								<span class="tx-log__entry-meta">
									<span>{entry.rowCount} rows</span>
									<span>{formatDuration(entry.durationMs)}</span>
									<span>{formatTime(entry.executedAt)}</span>
								</span>
							</div>
						)}
					</For>
				</Show>
			</div>

			<Show when={selectedEntry()}>
				{(entry) => (
					<div class="tx-log__detail">
						<div class="tx-log__detail-label">Full SQL</div>
						<pre class="tx-log__detail-sql">{entry().sql}</pre>
						<Show when={entry().errorMessage}>
							<div class="tx-log__detail-label" style={{ 'margin-top': 'var(--spacing-xs)' }}>Error</div>
							<div class="tx-log__detail-error">{entry().errorMessage}</div>
						</Show>
						<div class="tx-log__detail-meta">
							<span>Status: {entry().status}</span>
							<span>Duration: {formatDuration(entry().durationMs)}</span>
							<span>Rows: {entry().rowCount}</span>
							<span>Time: {formatTime(entry().executedAt)}</span>
						</div>
					</div>
				)}
			</Show>
		</div>
	)
}
