import type { Proposal } from '@dotaz/shared/types/rpc'
import { createStore } from 'solid-js/store'
import { proposalTabTitle, summarizeProposalRun } from '../lib/agent-proposals'
import { friendlyErrorMessage, rpc } from '../lib/rpc'
import { connectionsStore } from './connections'
import type { RunFinishedEvent } from './editor'
import { editorStore } from './editor'
import { tabsStore } from './tabs'
import { uiStore } from './ui'

/** Where a proposal is in the approve/reject flow. `resolved` keeps the outcome on screen. */
export type ProposalPhase = 'pending' | 'running' | 'resolved'

export interface ProposalEntry {
	proposal: Proposal
	/** SQL console tab hosting the banner. */
	tabId: string
	phase: ProposalPhase
	/** Outcome text shown after the proposal was resolved. */
	outcome: { status: 'executed' | 'failed'; message: string } | null
}

interface ProposalsState {
	/** Keyed by proposal id — several proposals can be waiting at once. */
	entries: Record<string, ProposalEntry>
}

const [state, setState] = createStore<ProposalsState>({ entries: {} })

function entryForTab(tabId: string): ProposalEntry | null {
	for (const entry of Object.values(state.entries)) {
		if (entry.tabId === tabId) return entry
	}
	return null
}

/** Why the app cannot run this proposal right now, or null when it can. */
function blockedReason(entry: ProposalEntry): string | null {
	const conn = connectionsStore.connections.find((c) => c.id === entry.proposal.connectionId)
	if (!conn) return 'The connection this proposal targets no longer exists.'
	if (conn.state !== 'connected') return `Connection "${conn.name}" is not connected.`
	if (connectionsStore.isReadOnly(entry.proposal.connectionId)) {
		return `Connection "${conn.name}" is marked read-only in Dotaz.`
	}
	return null
}

async function resolve(
	proposalId: string,
	status: 'executed' | 'failed' | 'rejected',
	payload?: { result?: { affectedRows?: number; statements?: number }; error?: string },
) {
	try {
		await rpc.agent['proposals.resolve']({ proposalId, status, result: payload?.result, error: payload?.error })
	} catch (err) {
		uiStore.addToast('error', `Failed to report the proposal outcome: ${friendlyErrorMessage(err)}`)
	}
}

/**
 * Subscribed while proposals are open. Any run in a proposal's tab settles it — the user may
 * hit the toolbar Run or Ctrl+Enter instead of the banner button, and it must not run twice.
 */
let unsubscribeRuns: (() => void) | null = null

function handleRunFinished(event: RunFinishedEvent) {
	const found = Object.entries(state.entries).find(([, entry]) => entry.tabId === event.tabId)
	if (!found) return
	const [proposalId, entry] = found
	if (entry.phase === 'resolved') return

	if (event.skipped) {
		// Nothing reached the database (read-only connection, destructive warning cancelled).
		if (entry.phase === 'running') setState('entries', proposalId, 'phase', 'pending')
		return
	}

	if (event.error) {
		setState('entries', proposalId, { phase: 'resolved', outcome: { status: 'failed', message: event.error } })
		resolve(proposalId, 'failed', { error: event.error })
		return
	}

	const outcome = summarizeProposalRun(event.results ?? [])
	setState('entries', proposalId, {
		phase: 'resolved',
		outcome: {
			status: outcome.status,
			message: outcome.error
				?? `${outcome.result.affectedRows} row(s) affected in ${outcome.result.statements} statement(s).`,
		},
	})
	resolve(proposalId, outcome.status, { result: outcome.result, error: outcome.error })
}

function removeEntry(proposalId: string) {
	setState('entries', proposalId, undefined!)
	if (unsubscribeRuns && Object.keys(state.entries).length === 0) {
		unsubscribeRuns()
		unsubscribeRuns = null
	}
}

/** Open a console tab for an incoming proposal. Never runs anything. */
function handleProposal(proposal: Proposal) {
	if (proposal.status !== 'pending') return

	const existing = state.entries[proposal.id]
	if (existing) {
		tabsStore.setActiveTab(existing.tabId)
		return
	}

	const conn = connectionsStore.connections.find((c) => c.id === proposal.connectionId)
	if (!conn) {
		uiStore.addToast('error', 'An agent proposed a write for a connection that no longer exists.')
		resolve(proposal.id, 'failed', { error: 'Connection not found in the app' })
		return
	}

	const label = proposal.database ?? conn.name
	const tabId = tabsStore.openTab({
		type: 'sql-console',
		title: proposalTabTitle(label),
		connectionId: proposal.connectionId,
		database: proposal.database,
	})
	editorStore.initTab(tabId, proposal.connectionId, proposal.database)
	editorStore.setContent(tabId, proposal.sql)

	setState('entries', proposal.id, { proposal, tabId, phase: 'pending', outcome: null })
	if (!unsubscribeRuns) {
		unsubscribeRuns = editorStore.onRunFinished(handleRunFinished)
	}
	uiStore.addToast('info', 'An agent proposed a write. Review it before running.')
}

/** Run the proposal through the console's normal execution path. The outcome arrives via handleRunFinished. */
function run(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry || entry.phase !== 'pending') return
	if (blockedReason(entry)) return

	const sql = editorStore.getTab(entry.tabId)?.content.trim()
	if (!sql) {
		uiStore.addToast('warning', 'Nothing to run — the console is empty.')
		return
	}

	setState('entries', proposalId, 'phase', 'running')
	editorStore.executeQuery(entry.tabId).catch((err) => {
		// The run never started, so no run outcome will arrive — report it here.
		if (state.entries[proposalId]?.phase !== 'running') return
		const message = friendlyErrorMessage(err)
		setState('entries', proposalId, { phase: 'resolved', outcome: { status: 'failed', message } })
		resolve(proposalId, 'failed', { error: message })
	})
}

/** Reject the proposal and dismiss its banner. */
function reject(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry || entry.phase === 'running') return
	removeEntry(proposalId)
	resolve(proposalId, 'rejected')
}

/** Dismiss a banner that already reported its outcome. */
function dismiss(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry || entry.phase !== 'resolved') return
	removeEntry(proposalId)
}

/** Closing the tab means the user did not approve — tell the CLI instead of leaving it hanging. */
function handleTabClosed(tabId: string) {
	for (const [proposalId, entry] of Object.entries(state.entries)) {
		if (entry.tabId !== tabId) continue
		const phase = entry.phase
		removeEntry(proposalId)
		if (phase === 'pending') {
			resolve(proposalId, 'rejected', { error: 'The approval tab was closed' })
		} else if (phase === 'running') {
			// The statement was already submitted, so its outcome is genuinely unknown.
			resolve(proposalId, 'failed', { error: 'The approval tab was closed while the statement was running' })
		}
	}
}

function connect(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry) return
	connectionsStore.connectTo(entry.proposal.connectionId)
}

export const proposalsStore = {
	get entries() {
		return state.entries
	},
	entryForTab,
	blockedReason,
	handleProposal,
	run,
	reject,
	dismiss,
	handleTabClosed,
	connect,
}
