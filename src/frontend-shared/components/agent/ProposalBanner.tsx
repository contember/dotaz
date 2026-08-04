import { Show } from 'solid-js'
import type { ProposalPhase } from '../../lib/proposal-state'
import { connectionsStore } from '../../stores/connections'
import { proposalsStore } from '../../stores/proposals'
import Icon from '../common/Icon'
import './ProposalBanner.css'

interface ProposalBannerProps {
	tabId: string
}

/** The proposal is settled — the tab keeps the SQL, the banner only offers Dismiss. */
function isTerminal(phase: ProposalPhase): boolean {
	return phase === 'resolved' || phase === 'invalidated'
}

function runLabel(phase: ProposalPhase): string {
	if (phase === 'checking') return 'Checking…'
	if (phase === 'running') return 'Running…'
	return 'Run'
}

/** Approval surface for a write an agent proposed through the CLI. Never runs on its own. */
export default function ProposalBanner(props: ProposalBannerProps) {
	const entry = () => proposalsStore.entryForTab(props.tabId)

	function target(): string {
		const e = entry()
		if (!e) return ''
		const conn = connectionsStore.connections.find((c) => c.id === e.proposal.connectionId)
		const name = conn?.name ?? e.proposal.connectionId
		return e.proposal.database ? `${name} / ${e.proposal.database}` : name
	}

	function blocked(): string | null {
		const e = entry()
		// A settled proposal cannot be run, so why it is blocked no longer matters.
		return e && !isTerminal(e.phase) ? proposalsStore.blockedReason(e) : null
	}

	function disconnected(): boolean {
		const e = entry()
		if (!e) return false
		const conn = connectionsStore.connections.find((c) => c.id === e.proposal.connectionId)
		return conn != null && conn.state !== 'connected'
	}

	return (
		<Show when={entry()}>
			{(e) => (
				<div
					class="proposal-banner"
					classList={{
						'proposal-banner--resolved': e().phase === 'resolved',
						'proposal-banner--invalidated': e().phase === 'invalidated',
					}}
				>
					<div class="proposal-banner__badge">
						<Icon name="sparkles" size={13} />
						Agent
					</div>

					<div class="proposal-banner__body">
						<p class="proposal-banner__headline">
							<Show
								when={e().phase === 'invalidated'}
								fallback={
									<>
										An agent wants to run this SQL on <strong>{target()}</strong>. It has not been executed.
									</>
								}
							>
								An agent proposed this SQL on <strong>{target()}</strong>.
							</Show>
						</p>
						<Show when={e().proposal.reason}>
							{(reason) => <p class="proposal-banner__reason">“{reason()}”</p>}
						</Show>
						<Show when={e().invalidReason}>
							{(reason) => (
								<p class="proposal-banner__invalid">
									<Icon name="info" size={12} />
									{reason()}
								</p>
							)}
						</Show>
						<Show when={blocked()}>
							{(reason) => (
								<p class="proposal-banner__blocked">
									<Icon name="warning" size={12} />
									{reason()}
								</p>
							)}
						</Show>
						<Show when={e().outcome}>
							{(outcome) => (
								<p
									class="proposal-banner__outcome"
									classList={{ 'proposal-banner__outcome--failed': outcome().status === 'failed' }}
								>
									<Icon name={outcome().status === 'failed' ? 'error' : 'check'} size={12} />
									{outcome().status === 'failed' ? 'Failed' : 'Executed'} — {outcome().message}
								</p>
							)}
						</Show>
					</div>

					<div class="proposal-banner__actions">
						<Show when={isTerminal(e().phase)}>
							<button class="btn btn--secondary btn--sm" onClick={() => proposalsStore.dismiss(e().proposal.id)}>
								Dismiss
							</button>
						</Show>
						<Show when={!isTerminal(e().phase)}>
							<Show when={disconnected()}>
								<button class="btn btn--secondary btn--sm" onClick={() => proposalsStore.connect(e().proposal.id)}>
									Connect
								</button>
							</Show>
							<button
								class="btn btn--primary btn--sm"
								disabled={e().phase !== 'pending' || blocked() !== null}
								title="Run the proposed SQL in this tab"
								onClick={() => void proposalsStore.run(e().proposal.id)}
							>
								<Show when={e().phase === 'pending'} fallback={<Icon name="spinner" size={12} />}>
									<Icon name="play" size={12} />
								</Show>
								{runLabel(e().phase)}
							</button>
							<button
								class="btn btn--secondary btn--sm"
								disabled={e().phase !== 'pending'}
								title="Tell the agent the write was rejected"
								onClick={() => proposalsStore.reject(e().proposal.id)}
							>
								Reject
							</button>
						</Show>
					</div>
				</div>
			)}
		</Show>
	)
}
