import Check from 'lucide-solid/icons/check'
import PlayCircle from 'lucide-solid/icons/circle-play'
import ListTree from 'lucide-solid/icons/list-tree'
import PinIcon from 'lucide-solid/icons/pin'
import PinOff from 'lucide-solid/icons/pin-off'
import Play from 'lucide-solid/icons/play'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import ScrollText from 'lucide-solid/icons/scroll-text'
import AlignLeft from 'lucide-solid/icons/text-align-start'
import { For, Show } from 'solid-js'
import { connectionsStore } from '../../stores/connections'
import { editorStore, type TxMode } from '../../stores/editor'
import { sessionStore } from '../../stores/session'
import Icon from '../common/Icon'
import './QueryToolbar.css'

interface QueryToolbarProps {
	tabId: string
	connectionId: string
	database?: string
	onOpenHistory?: () => void
	onOpenBookmarks?: () => void
	onToggleTransactionLog?: () => void
	transactionLogOpen?: boolean
}

export default function QueryToolbar(props: QueryToolbarProps) {
	const tab = () => editorStore.getTab(props.tabId)
	const connection = () => connectionsStore.connections.find((c) => c.id === props.connectionId)

	const isRunning = () => tab()?.isRunning ?? false
	const hasContent = () => (tab()?.content.trim().length ?? 0) > 0
	const duration = () => tab()?.duration ?? 0
	const txMode = () => tab()?.txMode ?? 'auto-commit'
	const inTransaction = () => tab()?.inTransaction ?? false
	const txAborted = () => tab()?.txAborted ?? false
	const isPinned = () => sessionStore.isTabPinned(props.tabId)
	const sessionLabel = () => sessionStore.getSessionLabelForTab(props.tabId)
	const isPostgres = () => connectionsStore.getConnectionType(props.connectionId) === 'postgresql'
	const schemaNames = () => connectionsStore.getSchemaNames(props.connectionId, props.database)
	const searchPath = () => tab()?.searchPath ?? null

	function handleRun() {
		editorStore.executeQuery(props.tabId)
	}

	function handleRunStatement() {
		editorStore.executeStatement(props.tabId)
	}

	function handleCancel() {
		editorStore.cancelQuery(props.tabId)
	}

	function handleExplain() {
		editorStore.explainQuery(props.tabId, false)
	}

	function handleExplainAnalyze() {
		editorStore.explainQuery(props.tabId, true)
	}

	function handleFormat() {
		editorStore.formatSql(props.tabId)
	}

	function handleTxModeChange(mode: TxMode) {
		editorStore.setTxMode(props.tabId, mode)
	}

	function handleBeginTx() {
		editorStore.beginTransaction(props.tabId)
	}

	function handleCommit() {
		editorStore.commitTransaction(props.tabId)
	}

	function handleRollback() {
		editorStore.rollbackTransaction(props.tabId)
	}

	function handleSearchPathChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value
		editorStore.setSearchPath(props.tabId, value === '' ? null : value)
	}

	function handleTogglePin() {
		if (isPinned()) {
			sessionStore.unpinSession(props.tabId)
		} else {
			sessionStore.pinSession(props.connectionId, props.tabId, props.database)
		}
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms} ms`
		return `${(ms / 1000).toFixed(1)} s`
	}

	return (
		<div class="query-toolbar">
			{/* Run / Cancel */}
			<Show
				when={!isRunning()}
				fallback={
					<button
						class="query-toolbar__btn query-toolbar__btn--cancel"
						onClick={handleCancel}
						title="Cancel query (Esc)"
					>
						<Icon name="stop" size={12} /> Cancel
					</button>
				}
			>
				<button
					class="query-toolbar__btn query-toolbar__btn--run"
					onClick={handleRun}
					disabled={!hasContent()}
					title="Run All (Ctrl+Enter)"
				>
					<Icon name="play" size={12} /> Run
				</button>
			</Show>

			{/* Run Statement */}
			<button
				class="query-toolbar__btn"
				onClick={handleRunStatement}
				disabled={!hasContent() || isRunning()}
				title="Run Statement (Ctrl+Shift+Enter)"
			>
				<Play size={12} /> Run Statement
			</button>

			{/* Explain */}
			<button
				class="query-toolbar__btn"
				onClick={handleExplain}
				disabled={!hasContent() || isRunning()}
				title="Explain (Ctrl+E)"
			>
				<ListTree size={12} /> Explain
			</button>

			{/* Explain Analyze */}
			<button
				class="query-toolbar__btn"
				onClick={handleExplainAnalyze}
				disabled={!hasContent() || isRunning()}
				title="Explain Analyze (Ctrl+Shift+E)"
			>
				<ListTree size={12} /> Analyze
			</button>

			{/* Format */}
			<button
				class="query-toolbar__btn"
				onClick={handleFormat}
				disabled={!hasContent() || isRunning()}
				title="Format SQL"
			>
				<AlignLeft size={12} /> Format
			</button>

			{/* History */}
			<Show when={props.onOpenHistory}>
				<button
					class="query-toolbar__btn"
					onClick={props.onOpenHistory}
					title="Query History"
				>
					<Icon name="history" size={12} /> History
				</button>
			</Show>

			{/* Bookmarks */}
			<Show when={props.onOpenBookmarks}>
				<button
					class="query-toolbar__btn"
					onClick={props.onOpenBookmarks}
					title="SQL Bookmarks (Ctrl+D)"
				>
					<Icon name="bookmark" size={12} /> Bookmarks
				</button>
			</Show>

			{/* AI Generate */}
			<button
				class={`query-toolbar__btn${tab()?.aiPromptOpen ? ' query-toolbar__btn--active' : ''}`}
				onClick={() => editorStore.toggleAiPrompt(props.tabId)}
				disabled={isRunning()}
				title="Generate SQL with AI (Ctrl+G)"
			>
				<Icon name="sparkles" size={12} /> AI
			</button>

			{/* Transaction Log */}
			<Show when={props.onToggleTransactionLog}>
				<button
					class={`query-toolbar__btn${props.transactionLogOpen ? ' query-toolbar__btn--active' : ''}`}
					onClick={props.onToggleTransactionLog}
					title="Transaction Log"
				>
					<ScrollText size={12} /> Log
				</button>
			</Show>

			<div class="query-toolbar__separator" />

			{/* Session pin/unpin */}
			<button
				class={`query-toolbar__btn${isPinned() ? ' query-toolbar__btn--pinned' : ''}`}
				onClick={handleTogglePin}
				title={isPinned() ? `Unpin session (${sessionLabel()})` : 'Pin to dedicated session'}
			>
				<Show
					when={isPinned()}
					fallback={
						<>
							<PinIcon size={12} /> Pool
						</>
					}
				>
					<PinOff size={12} /> {sessionLabel()}
				</Show>
			</button>

			{/* Transaction mode toggle */}
			<div class="query-toolbar__tx-toggle">
				<button
					class={`query-toolbar__tx-option${txMode() === 'auto-commit' ? ' query-toolbar__tx-option--active' : ''}`}
					onClick={() => handleTxModeChange('auto-commit')}
					title="Auto-commit mode"
				>
					Auto
				</button>
				<button
					class={`query-toolbar__tx-option${txMode() === 'manual' ? ' query-toolbar__tx-option--active' : ''}`}
					onClick={() => handleTxModeChange('manual')}
					title="Manual transaction mode"
				>
					Manual
				</button>
			</div>

			{/* Manual transaction controls */}
			<Show when={txMode() === 'manual'}>
				<Show
					when={inTransaction()}
					fallback={
						<button
							class="query-toolbar__btn"
							onClick={handleBeginTx}
							title="Begin Transaction"
						>
							<PlayCircle size={12} /> Begin
						</button>
					}
				>
					<div
						class={txAborted() ? 'query-toolbar__tx-indicator query-toolbar__tx-indicator--aborted' : 'query-toolbar__tx-indicator'}
						title={txAborted() ? 'Transaction is aborted — rollback required' : 'Transaction active'}
					>
						{txAborted() ? 'TXN ABORTED' : 'TXN'}
					</div>
					<button
						class="query-toolbar__btn"
						onClick={handleCommit}
						disabled={txAborted()}
						title={txAborted() ? 'Cannot commit an aborted transaction' : 'Commit Transaction'}
					>
						<Check size={12} /> Commit
					</button>
					<button
						class="query-toolbar__btn"
						onClick={handleRollback}
						title="Rollback Transaction"
					>
						<RotateCcw size={12} /> Rollback
					</button>
				</Show>
			</Show>

			{/* Schema (search_path) — PostgreSQL only */}
			<Show when={isPostgres() && schemaNames().length > 0}>
				<div class="query-toolbar__separator" />
				<select
					class="query-toolbar__schema-select"
					value={searchPath() ?? ''}
					onChange={handleSearchPathChange}
					title="Search path (schema)"
				>
					<option value="">Default</option>
					<For each={schemaNames()}>
						{(name) => <option value={`"${name}"`}>{name}</option>}
					</For>
				</select>
			</Show>

			<div class="query-toolbar__separator" />

			{/* Connection info */}
			<div class="query-toolbar__connection">
				<span class="query-toolbar__connection-name">
					{connection()?.name ?? '\u2014'}
					<Show when={props.database}>
						<span style={{ color: 'var(--ink-muted)' }}>/ {props.database}</span>
					</Show>
				</span>
			</div>

			<div class="query-toolbar__spacer" />

			{/* Duration */}
			<Show when={duration() > 0}>
				<div class="query-toolbar__duration">
					{formatDuration(duration())}
				</div>
			</Show>
		</div>
	)
}
