import Copy from 'lucide-solid/icons/copy'
import Pencil from 'lucide-solid/icons/pencil'
import Play from 'lucide-solid/icons/play'
import Trash2 from 'lucide-solid/icons/trash-2'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { QueryBookmark } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { tabsStore } from '../../stores/tabs'
import Dialog from '../common/Dialog'
import Icon from '../common/Icon'
import Select from '../common/Select'
import './BookmarksDialog.css'

interface BookmarksDialogProps {
	open: boolean
	onClose: () => void
	/** Pre-fill with SQL from the active editor */
	initialSql?: string
	/** Pre-fill connection from the active editor */
	initialConnectionId?: string
	/** Pre-fill database from the active editor */
	initialDatabase?: string
}

const SQL_TRUNCATE_LENGTH = 100
const TOAST_DURATION = 1500

type FormMode = { mode: 'idle' } | { mode: 'editing'; bookmark: QueryBookmark } | { mode: 'creating' }

export default function BookmarksDialog(props: BookmarksDialogProps) {
	const [bookmarks, setBookmarks] = createSignal<QueryBookmark[]>([])
	const [search, setSearch] = createSignal('')
	const [connectionFilter, setConnectionFilter] = createSignal('')
	const [loading, setLoading] = createSignal(false)
	const [toast, setToast] = createSignal<string | null>(null)

	const [formMode, setFormMode] = createSignal<FormMode>({ mode: 'idle' })
	const [formState, setFormState] = createStore({
		name: '',
		description: '',
		sql: '',
		database: undefined as string | undefined,
		error: null as string | null,
		saving: false,
	})

	let searchDebounce: ReturnType<typeof setTimeout> | undefined

	createEffect(() => {
		if (props.open) {
			const connId = props.initialConnectionId || ''
			setConnectionFilter(connId)
			setSearch('')
			setFormMode({ mode: 'idle' })
			resetForm()

			// If we have initial SQL, go directly to create mode
			if (props.initialSql && connId) {
				setFormMode({ mode: 'creating' })
				setFormState('sql', props.initialSql)
				setFormState('database', props.initialDatabase)
			}

			loadBookmarks(connId)
		}
	})

	onCleanup(() => {
		if (searchDebounce) clearTimeout(searchDebounce)
	})

	function resetForm() {
		setFormState(
			reconcile({ name: '', description: '', sql: '', database: undefined as string | undefined, error: null as string | null, saving: false }),
		)
	}

	async function loadBookmarks(connId?: string) {
		const connectionId = connId ?? connectionFilter()
		if (!connectionId) {
			setBookmarks([])
			return
		}
		setLoading(true)
		try {
			const result = await rpc.bookmarks.list({ connectionId, search: search() || undefined })
			setBookmarks(result)
		} catch {
			// Non-critical
		} finally {
			setLoading(false)
		}
	}

	function handleSearchInput(value: string) {
		setSearch(value)
		if (searchDebounce) clearTimeout(searchDebounce)
		searchDebounce = setTimeout(() => loadBookmarks(), 300)
	}

	function handleConnectionFilterChange(value: string) {
		setConnectionFilter(value)
		loadBookmarks(value)
	}

	function showToast(message: string) {
		setToast(message)
		setTimeout(() => setToast(null), TOAST_DURATION)
	}

	function truncateSql(sql: string): string {
		const oneLine = sql.replace(/\s+/g, ' ').trim()
		if (oneLine.length <= SQL_TRUNCATE_LENGTH) return oneLine
		return oneLine.slice(0, SQL_TRUNCATE_LENGTH) + '...'
	}

	function startCreate() {
		setFormMode({ mode: 'creating' })
		resetForm()
		// Pre-fill SQL and database from active editor
		const activeTab = tabsStore.activeTab
		if (activeTab?.type === 'sql-console') {
			const tab = editorStore.getTab(activeTab.id)
			if (tab?.content.trim()) {
				setFormState('sql', tab.content)
			}
			setFormState('database', activeTab.database)
		}
	}

	function startEdit(bookmark: QueryBookmark) {
		setFormMode({ mode: 'editing', bookmark })
		setFormState(reconcile({
			name: bookmark.name,
			description: bookmark.description,
			sql: bookmark.sql,
			database: undefined as string | undefined,
			error: null as string | null,
			saving: false,
		}))
	}

	function cancelForm() {
		setFormMode({ mode: 'idle' })
		resetForm()
	}

	async function handleSave() {
		const name = formState.name.trim()
		if (!name) {
			setFormState('error', 'Name is required')
			return
		}
		const sqlText = formState.sql.trim()
		if (!sqlText) {
			setFormState('error', 'SQL is required')
			return
		}

		setFormState('saving', true)
		setFormState('error', null)

		try {
			const fm = formMode()
			if (fm.mode === 'editing') {
				await rpc.bookmarks.update({
					id: fm.bookmark.id,
					name,
					description: formState.description.trim(),
					sql: sqlText,
				})
				showToast('Bookmark updated')
			} else {
				const connId = connectionFilter()
				if (!connId) {
					setFormState('error', 'Select a connection first')
					setFormState('saving', false)
					return
				}
				await rpc.bookmarks.create({
					connectionId: connId,
					database: formState.database,
					name,
					description: formState.description.trim(),
					sql: sqlText,
				})
				showToast('Bookmark saved')
			}
			setFormMode({ mode: 'idle' })
			resetForm()
			loadBookmarks()
		} catch (err) {
			setFormState('error', err instanceof Error ? err.message : String(err))
		} finally {
			setFormState('saving', false)
		}
	}

	async function handleDelete(bookmark: QueryBookmark) {
		const confirmed = window.confirm(`Delete bookmark "${bookmark.name}"?`)
		if (!confirmed) return

		try {
			await rpc.bookmarks.delete({ id: bookmark.id })
			loadBookmarks()
			showToast('Bookmark deleted')
		} catch {
			// Non-critical
		}
	}

	function handleUseBookmark(bookmark: QueryBookmark) {
		const activeTab = tabsStore.activeTab
		if (activeTab?.type === 'sql-console') {
			editorStore.setContent(activeTab.id, bookmark.sql)
			showToast('SQL loaded')
			props.onClose()
			return
		}
		// Open a new SQL console with the bookmark's SQL
		const tabId = tabsStore.openTab({
			type: 'sql-console',
			title: bookmark.name,
			connectionId: bookmark.connectionId,
			database: bookmark.database,
		})
		editorStore.initTab(tabId, bookmark.connectionId, bookmark.database)
		editorStore.setContent(tabId, bookmark.sql)
		props.onClose()
	}

	async function handleCopy(bookmark: QueryBookmark) {
		try {
			await navigator.clipboard.writeText(bookmark.sql)
			showToast('Copied to clipboard')
		} catch {
			// Clipboard access denied
		}
	}

	function handleFormKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.ctrlKey && !formState.saving) {
			e.preventDefault()
			handleSave()
		}
	}

	const connectedConnections = () => connectionsStore.connections.filter((c) => c.state === 'connected')

	const isFormOpen = () => formMode().mode !== 'idle'

	return (
		<Dialog
			open={props.open}
			title="SQL Bookmarks"
			onClose={props.onClose}
		>
			<div class="bookmarks-dialog">
				{/* Form mode */}
				<Show when={isFormOpen()}>
					<div class="bookmarks-dialog__form" onKeyDown={handleFormKeyDown}>
						<div class="bookmarks-dialog__field">
							<label class="bookmarks-dialog__label">Name</label>
							<input
								class="bookmarks-dialog__input"
								type="text"
								value={formState.name}
								onInput={(e) => setFormState('name', e.currentTarget.value)}
								placeholder="e.g. Active users query"
								autofocus
							/>
						</div>
						<div class="bookmarks-dialog__field">
							<label class="bookmarks-dialog__label">
								Description <span class="bookmarks-dialog__optional">(optional)</span>
							</label>
							<input
								class="bookmarks-dialog__input"
								type="text"
								value={formState.description}
								onInput={(e) => setFormState('description', e.currentTarget.value)}
								placeholder="Brief description..."
							/>
						</div>
						<div class="bookmarks-dialog__field">
							<label class="bookmarks-dialog__label">SQL</label>
							<textarea
								class="bookmarks-dialog__textarea"
								value={formState.sql}
								onInput={(e) => setFormState('sql', e.currentTarget.value)}
								placeholder="SELECT ..."
								rows={6}
							/>
						</div>
						<Show when={formState.error}>
							<div class="bookmarks-dialog__error">{formState.error}</div>
						</Show>
						<div class="bookmarks-dialog__form-actions">
							<button class="btn btn--secondary" onClick={cancelForm}>Cancel</button>
							<button
								class="btn btn--primary"
								onClick={handleSave}
								disabled={formState.saving || !formState.name.trim() || !formState.sql.trim()}
							>
								{formState.saving ? 'Saving...' : formMode().mode === 'editing' ? 'Update' : 'Save'}
							</button>
						</div>
					</div>
				</Show>

				{/* List mode */}
				<Show when={!isFormOpen()}>
					<div class="bookmarks-dialog__filters">
						<input
							class="bookmarks-dialog__search"
							type="text"
							placeholder="Search bookmarks..."
							value={search()}
							onInput={(e) => handleSearchInput(e.currentTarget.value)}
						/>
						<Select
							class="bookmarks-dialog__connection-filter"
							value={connectionFilter()}
							onChange={(v) => handleConnectionFilterChange(v)}
							options={[{ value: '', label: 'Select connection' }, ...connectedConnections().map((conn) => ({ value: conn.id, label: conn.name }))]}
						/>
						<button
							class="bookmarks-dialog__add-btn"
							onClick={startCreate}
							disabled={!connectionFilter()}
							title="Add bookmark"
						>
							+ Add
						</button>
					</div>

					<div class="bookmarks-dialog__list">
						<Show when={!connectionFilter()}>
							<div class="empty-state">
								<Icon name="bookmark" size={28} class="empty-state__icon" />
								<div class="empty-state__title">Select a connection</div>
								<div class="empty-state__subtitle">Choose a connection to view its bookmarks.</div>
							</div>
						</Show>

						<Show when={connectionFilter() && bookmarks().length === 0 && !loading()}>
							<div class="empty-state">
								<Icon name="bookmark" size={28} class="empty-state__icon" />
								<div class="empty-state__title">
									{search() ? 'No matching bookmarks' : 'No bookmarks yet'}
								</div>
								<div class="empty-state__subtitle">
									{search()
										? 'Try different search terms.'
										: 'Save your favorite queries for quick access.'}
								</div>
							</div>
						</Show>

						<For each={bookmarks()}>
							{(bookmark) => (
								<div class="bookmarks-dialog__entry">
									<div class="bookmarks-dialog__entry-header" onClick={() => handleUseBookmark(bookmark)}>
										<span class="bookmarks-dialog__bookmark-icon">
											<Icon name="bookmark" size={12} />
										</span>
										<div class="bookmarks-dialog__entry-info">
											<span class="bookmarks-dialog__name">{bookmark.name}</span>
											<Show when={bookmark.description}>
												<span class="bookmarks-dialog__description">{bookmark.description}</span>
											</Show>
										</div>
									</div>
									<div class="bookmarks-dialog__sql-preview">
										{truncateSql(bookmark.sql)}
									</div>
									<div class="bookmarks-dialog__entry-actions">
										<button
											class="bookmarks-dialog__action-btn"
											onClick={() => handleUseBookmark(bookmark)}
											title="Load into editor"
										>
											<Play size={12} /> Use
										</button>
										<button
											class="bookmarks-dialog__action-btn"
											onClick={() => handleCopy(bookmark)}
											title="Copy SQL to clipboard"
										>
											<Copy size={12} /> Copy
										</button>
										<button
											class="bookmarks-dialog__action-btn"
											onClick={() => startEdit(bookmark)}
											title="Edit bookmark"
										>
											<Pencil size={12} /> Edit
										</button>
										<button
											class="bookmarks-dialog__action-btn bookmarks-dialog__action-btn--danger"
											onClick={() => handleDelete(bookmark)}
											title="Delete bookmark"
										>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
							)}
						</For>

						<Show when={loading()}>
							<div class="bookmarks-dialog__loading">
								<Icon name="spinner" size={14} />
								Loading...
							</div>
						</Show>
					</div>
				</Show>

				{/* Toast */}
				<Show when={toast()}>
					<div class="bookmarks-dialog__toast">{toast()}</div>
				</Show>
			</div>
		</Dialog>
	)
}
