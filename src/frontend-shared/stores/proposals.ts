import type { Proposal } from '@dotaz/shared/types/rpc'
import { createStore } from 'solid-js/store'
import { proposalTabTitle, summarizeProposalRun } from '../lib/agent-proposals'
import {
	decideProposalMessage,
	invalidationReason,
	isStaleProposalError,
	PROPOSAL_ALREADY_RESOLVED_REASON,
	PROPOSAL_GONE_REASON,
	type ProposalPhase,
} from '../lib/proposal-state'
import { friendlyErrorMessage, rpc } from '../lib/rpc'
import { connectionsStore } from './connections'
import type { RunFinishedEvent } from './editor'
import { editorStore } from './editor'
import { tabsStore } from './tabs'
import { uiStore } from './ui'

export interface ProposalEntry {
	proposal: Proposal
	/** SQL console tab hosting the banner. */
	tabId: string
	phase: ProposalPhase
	/** Outcome text shown after the proposal was resolved. */
	outcome: { status: 'executed' | 'failed'; message: string } | null
	/** Why the banner went terminal without this window resolving it. */
	invalidReason: string | null
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

/** Terminal banner state for a proposal that is no longer the app's to act on. */
function invalidate(proposalId: string, reason: string) {
	const entry = state.entries[proposalId]
	// Never rip away a banner mid-run or one already showing this window's own outcome.
	if (!entry || entry.phase === 'running' || entry.phase === 'resolved' || entry.phase === 'invalidated') return
	setState('entries', proposalId, { phase: 'invalidated', invalidReason: reason })
}

async function resolve(
	proposalId: string,
	status: 'executed' | 'failed' | 'rejected',
	payload?: { result?: { affectedRows?: number; statements?: number }; error?: string },
) {
	try {
		await rpc.agent['proposals.resolve']({ proposalId, status, result: payload?.result, error: payload?.error })
	} catch (err) {
		if (isStaleProposalError(err)) {
			// It left `pending` behind our back — the banner explains that, a toast would only confuse.
			console.debug(`Proposal ${proposalId} was already resolved:`, err)
			invalidate(proposalId, PROPOSAL_ALREADY_RESOLVED_REASON)
			return
		}
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
	// A terminal banner no longer speaks for the proposal, whatever the user runs in the tab.
	if (entry.phase === 'resolved' || entry.phase === 'invalidated') return

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

/** Open a console tab for a new proposal. Never runs anything. */
function openProposalTab(proposal: Proposal) {
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

	setState('entries', proposal.id, { proposal, tabId, phase: 'pending', outcome: null, invalidReason: null })
	if (!unsubscribeRuns) {
		unsubscribeRuns = editorStore.onRunFinished(handleRunFinished)
	}
	uiStore.addToast('info', 'An agent proposed a write. Review it before running.')
}

/** Apply a proposal state change pushed by the backend. */
function handleProposal(proposal: Proposal) {
	const entry = state.entries[proposal.id]
	const action = decideProposalMessage(entry, proposal)
	switch (action.kind) {
		case 'ignore':
			return
		case 'focus':
			if (entry) tabsStore.setActiveTab(entry.tabId)
			return
		case 'invalidate':
			invalidate(proposal.id, action.reason)
			return
		case 'open':
			openProposalTab(proposal)
			return
	}
}

/**
 * Confirm server-side that the proposal is still runnable. The `cli.proposal` message
 * announcing a cancellation or expiry may not have arrived yet, and Run must not beat it.
 */
async function confirmStillPending(proposalId: string): Promise<boolean> {
	try {
		const proposal = await rpc.agent['proposals.get']({ proposalId })
		if (proposal.status === 'pending') return true
		invalidate(proposalId, invalidationReason(proposal.status))
		return false
	} catch (err) {
		if (isStaleProposalError(err)) {
			invalidate(proposalId, PROPOSAL_GONE_REASON)
			return false
		}
		// Could not reach the backend — say so and leave the banner actionable.
		uiStore.addToast('error', `Could not check the proposal: ${friendlyErrorMessage(err)}`)
		if (state.entries[proposalId]?.phase === 'checking') setState('entries', proposalId, 'phase', 'pending')
		return false
	}
}

/** Run the proposal through the console's normal execution path. The outcome arrives via handleRunFinished. */
async function run(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry || entry.phase !== 'pending') return
	if (blockedReason(entry)) return

	const sql = editorStore.getTab(entry.tabId)?.content.trim()
	if (!sql) {
		uiStore.addToast('warning', 'Nothing to run — the console is empty.')
		return
	}

	setState('entries', proposalId, 'phase', 'checking')
	if (!await confirmStillPending(proposalId)) return
	// The check was async — the entry may have been invalidated or closed meanwhile.
	if (state.entries[proposalId]?.phase !== 'checking') return

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
	if (!entry || entry.phase !== 'pending') return
	removeEntry(proposalId)
	resolve(proposalId, 'rejected')
}

/** Dismiss a banner that already reported its outcome, or one that went stale. */
function dismiss(proposalId: string) {
	const entry = state.entries[proposalId]
	if (!entry || (entry.phase !== 'resolved' && entry.phase !== 'invalidated')) return
	removeEntry(proposalId)
}

/** Closing the tab means the user did not approve — tell the CLI instead of leaving it hanging. */
function handleTabClosed(tabId: string) {
	for (const [proposalId, entry] of Object.entries(state.entries)) {
		if (entry.tabId !== tabId) continue
		const phase = entry.phase
		removeEntry(proposalId)
		if (phase === 'pending' || phase === 'checking') {
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
