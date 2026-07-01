import type { ConnectionHandleInfo } from '@dotaz/shared/types/rpc'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { friendlyErrorMessage, rpc } from '../../lib/rpc'
import { uiStore } from '../../stores/ui'
import Dialog from '../common/Dialog'
import Icon from '../common/Icon'
import './ConnectionInspectorDialog.css'

interface ConnectionInspectorDialogProps {
	open: boolean
	onClose: () => void
}

const ROLE_LABELS: Record<ConnectionHandleInfo['role'], string> = {
	system: 'System',
	idle: 'Idle',
	temporary: 'Temporary',
	session: 'Session',
	'default-transaction': 'Default TX',
	'sqlite-main': 'SQLite main',
	'sqlite-iterate': 'SQLite read',
}

const STATE_LABELS: Record<ConnectionHandleInfo['state'], string> = {
	idle: 'Idle',
	active: 'Active',
	transaction: 'TX',
}

export default function ConnectionInspectorDialog(props: ConnectionInspectorDialogProps) {
	const [handles, setHandles] = createSignal<ConnectionHandleInfo[]>([])
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [terminatingKey, setTerminatingKey] = createSignal<string | null>(null)
	const [now, setNow] = createSignal(Date.now())

	const sortedHandles = createMemo(() =>
		[...handles()].sort((a, b) =>
			a.connectionName.localeCompare(b.connectionName)
			|| a.database.localeCompare(b.database)
			|| a.role.localeCompare(b.role)
			|| a.handleId.localeCompare(b.handleId)
		)
	)

	const activeCount = createMemo(() => handles().filter((handle) => handle.state !== 'idle').length)
	const sessionCount = createMemo(() => handles().filter((handle) => handle.role === 'session').length)
	const txCount = createMemo(() => handles().filter((handle) => handle.inTransaction).length)

	createEffect(() => {
		if (!props.open) return
		loadHandles()
		const refreshTimer = setInterval(() => {
			loadHandles({ quiet: true })
		}, 2500)
		const clockTimer = setInterval(() => setNow(Date.now()), 1000)
		onCleanup(() => {
			clearInterval(refreshTimer)
			clearInterval(clockTimer)
		})
	})

	async function loadHandles(options?: { quiet?: boolean }) {
		if (!options?.quiet) {
			setLoading(true)
		}
		try {
			const list = await rpc.connections.listOpenHandles()
			setHandles(list)
			setError(null)
		} catch (err) {
			setError(friendlyErrorMessage(err))
		} finally {
			if (!options?.quiet) {
				setLoading(false)
			}
		}
	}

	async function terminateHandle(handle: ConnectionHandleInfo) {
		if (!handle.canTerminate) return
		const confirmed = await uiStore.confirm({
			title: 'Terminate connection handle',
			message: `Terminate ${ROLE_LABELS[handle.role]} on ${handle.connectionName}/${handle.database}? Running work on this handle will fail.`,
			confirmLabel: 'Terminate',
			danger: true,
		})
		if (!confirmed) return

		const key = rowKey(handle)
		setTerminatingKey(key)
		try {
			await rpc.connections.terminateHandle({
				connectionId: handle.connectionId,
				database: handle.database,
				handleId: handle.handleId,
			})
			uiStore.addToast('info', 'Connection handle terminated.')
			await loadHandles({ quiet: true })
		} catch (err) {
			uiStore.addToast('error', friendlyErrorMessage(err))
		} finally {
			setTerminatingKey(null)
		}
	}

	function rowKey(handle: ConnectionHandleInfo): string {
		return `${handle.connectionId}:${handle.database}:${handle.handleId}`
	}

	function formatAge(timestamp: number): string {
		const elapsed = Math.max(0, now() - timestamp)
		if (elapsed < 1000) return 'now'
		const seconds = Math.floor(elapsed / 1000)
		if (seconds < 60) return `${seconds}s`
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m ${seconds % 60}s`
		const hours = Math.floor(minutes / 60)
		return `${hours}h ${minutes % 60}m`
	}

	return (
		<Dialog open={props.open} title="Open Connection Handles" onClose={props.onClose} class="connection-inspector-dialog">
			<div class="connection-inspector">
				<div class="connection-inspector__toolbar">
					<div class="connection-inspector__metrics">
						<span>
							<strong>{handles().length}</strong> open
						</span>
						<span>
							<strong>{activeCount()}</strong> active
						</span>
						<span>
							<strong>{sessionCount()}</strong> sessions
						</span>
						<span>
							<strong>{txCount()}</strong> tx
						</span>
					</div>
					<button class="connection-inspector__icon-btn" onClick={() => loadHandles()} disabled={loading()} title="Refresh handles">
						<Icon name={loading() ? 'spinner' : 'refresh'} size={14} />
					</button>
				</div>

				<Show when={error()}>
					{(message) => (
						<div class="connection-inspector__error">
							<Icon name="error" size={14} />
							<span>{message()}</span>
						</div>
					)}
				</Show>

				<Show
					when={sortedHandles().length > 0}
					fallback={
						<div class="connection-inspector__empty">
							<Icon name="database" size={20} />
							<span>No open handles</span>
						</div>
					}
				>
					<div class="connection-inspector__table-wrap">
						<table class="connection-inspector__table">
							<thead>
								<tr>
									<th>Connection</th>
									<th>Database</th>
									<th>Handle</th>
									<th>Role</th>
									<th>State</th>
									<th>Queries</th>
									<th>Age</th>
									<th>Idle</th>
									<th aria-label="Actions"></th>
								</tr>
							</thead>
							<tbody>
								<For each={sortedHandles()}>
									{(handle) => (
										<tr>
											<td class="connection-inspector__connection">{handle.connectionName}</td>
											<td class="connection-inspector__database" title={handle.database}>{handle.database}</td>
											<td>
												<code class="connection-inspector__handle">{handle.handleId}</code>
												<Show when={handle.label}>
													<span class="connection-inspector__session-label">{handle.label}</span>
												</Show>
											</td>
											<td>{ROLE_LABELS[handle.role]}</td>
											<td>
												<span class={`connection-inspector__state connection-inspector__state--${handle.state}`}>
													{STATE_LABELS[handle.state]}
												</span>
											</td>
											<td class="connection-inspector__number">{handle.activeQueryCount}</td>
											<td class="connection-inspector__time">{formatAge(handle.createdAt)}</td>
											<td class="connection-inspector__time">{formatAge(handle.lastUsedAt)}</td>
											<td class="connection-inspector__actions">
												<button
													class="connection-inspector__icon-btn connection-inspector__icon-btn--danger"
													onClick={() => terminateHandle(handle)}
													disabled={!handle.canTerminate || terminatingKey() === rowKey(handle)}
													title={handle.canTerminate ? 'Terminate handle' : 'Handle cannot be terminated'}
												>
													<Icon name={terminatingKey() === rowKey(handle) ? 'spinner' : 'stop'} size={13} />
												</button>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</Show>
			</div>
		</Dialog>
	)
}
