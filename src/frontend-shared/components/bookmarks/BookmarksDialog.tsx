import Copy from 'lucide-solid/icons/copy'
import Pencil from 'lucide-solid/icons/pencil'
import Play from 'lucide-solid/icons/play'
import Trash2 from 'lucide-solid/icons/trash-2'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { QueryBookmark } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { tabsStore } from '../../stores/tabs'
import Dialog from '../common/Dialog'
import Icon from '../common/Icon'
import './BookmarksDialog.css'

interface BookmarksDialogProps {
	open: boolean
	onClose: () => void
	/** Pre-fill with SQL from the active editor */
	initialSql?: string
	/** Pre-fill connection from the active editor */
	initialConnectionId?: string
}

const SQL_TRUNCATE_LENGTH = 100
const TOAST_DURATION = 1500

export default function BookmarksDialog(props: BookmarksDialogProps) {
	const [bookmarks, setBookmarks] = createSignal<QueryBookmark[]>([])
	const [search, setSearch] = createSignal('')
	const [connectionFilter, setConnectionFilter] = createSignal('')
	const [loading, setLoading] = createSignal(false)
	const [toast, setToast] = createSignal<string | null>(null)

	// Edit/create form state
	const [editing, setEditing] = createSignal<QueryBookmark | null>(null)
	const [creating, setCreating] = createSignal(false)
	const [formName, setFormName] = createSignal('')
	const [formDescription, setFormDescription] = createSignal('')
	const [formSql, setFormSql] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	let searchDebounce: ReturnType<typeof setTimeout> | undefined

	createEffect(() => {
		if (props.open) {
			const connId = props.initialConnectionId || ''
			setConnectionFilter(connId)
			setSearch('')
			setEditing(null)
			setCreating(false)
			resetForm()

			// If we have initial SQL, go directly to create mode
			if (props.initialSql && connId) {
				setCreating(true)
				setFormSql(props.initialSql)
			}

			loadBookmarks(connId)
		}
	})

	onCleanup(() => {
		if (searchDebounce) clearTimeout(searchDebounce)
	})

	function resetForm() {
		setFormName('')
		setFormDescription('')
		setFormSql('')
		setFormError(null)
		setSaving(false)
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
		setEditing(null)
		setCreating(true)
		resetForm()
		// Pre-fill SQL from active editor
		const activeTab = tabsStore.activeTab
		if (activeTab?.type === 'sql-console') {
			const tab = editorStore.getTab(activeTab.id)
			if (tab?.content.trim()) {
				setFormSql(tab.content)
			}
		}
	}

	function startEdit(bookmark: QueryBookmark) {
		setCreating(false)
		setEditing(bookmark)
		setFormName(bookmark.name)
		setFormDescription(bookmark.description)
		setFormSql(bookmark.sql)
		setFormError(null)
		setSaving(false)
	}

	function cancelForm() {
		setEditing(null)
		setCreating(false)
		resetForm()
	}

	async function handleSave() {
		const name = formName().trim()
		if (!name) {
			setFormError('Name is required')
			return
		}
		const sqlText = formSql().trim()
		if (!sqlText) {
			setFormError('SQL is required')
			return
		}

		setSaving(true)
		setFormError(null)

		try {
			if (editing()) {
				await rpc.bookmarks.update({
					id: editing()!.id,
					name,
					description: formDescription().trim(),
					sql: sqlText,
				})
				showToast('Bookmark updated')
			} else {
				const connId = connectionFilter()
				if (!connId) {
					setFormError('Select a connection first')
					setSaving(false)
					return
				}
				await rpc.bookmarks.create({
					connectionId: connId,
					name,
					description: formDescription().trim(),
					sql: sqlText,
				})
				showToast('Bookmark saved')
			}
			setEditing(null)
			setCreating(false)
			resetForm()
			loadBookmarks()
		} catch (err) {
			setFormError(err instanceof Error ? err.message : String(err))
		} finally {
			setSaving(false)
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
		})
		editorStore.initTab(tabId, bookmark.connectionId)
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
		if (e.key === 'Enter' && e.ctrlKey && !saving()) {
			e.preventDefault()
			handleSave()
		}
	}

	const connectedConnections = () => connectionsStore.connections.filter((c) => c.state === 'connected')

	const isFormOpen = () => creating() || editing() !== null

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
								value={formName()}
								onInput={(e) => setFormName(e.currentTarget.value)}
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
								value={formDescription()}
								onInput={(e) => setFormDescription(e.currentTarget.value)}
								placeholder="Brief description..."
							/>
						</div>
						<div class="bookmarks-dialog__field">
							<label class="bookmarks-dialog__label">SQL</label>
							<textarea
								class="bookmarks-dialog__textarea"
								value={formSql()}
								onInput={(e) => setFormSql(e.currentTarget.value)}
								placeholder="SELECT ..."
								rows={6}
							/>
						</div>
						<Show when={formError()}>
							<div class="bookmarks-dialog__error">{formError()}</div>
						</Show>
						<div class="bookmarks-dialog__form-actions">
							<button class="btn btn--secondary" onClick={cancelForm}>Cancel</button>
							<button
								class="btn btn--primary"
								onClick={handleSave}
								disabled={saving() || !formName().trim() || !formSql().trim()}
							>
								{saving() ? 'Saving...' : editing() ? 'Update' : 'Save'}
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
						<select
							class="bookmarks-dialog__connection-filter"
							value={connectionFilter()}
							onChange={(e) => handleConnectionFilterChange(e.currentTarget.value)}
						>
							<option value="">Select connection</option>
							<For each={connectedConnections()}>
								{(conn) => <option value={conn.id}>{conn.name}</option>}
							</For>
						</select>
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
