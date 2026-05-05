import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import Copy from 'lucide-solid/icons/copy'
import { createMemo, createSignal, For, Show } from 'solid-js'
import './JsonTreeView.css'

interface JsonTreeViewProps {
	value: unknown
}

export default function JsonTreeView(props: JsonTreeViewProps) {
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
	const [searchQuery, setSearchQuery] = createSignal('')
	const [copiedPath, setCopiedPath] = createSignal<string | null>(null)

	function toggle(path: string) {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(path)) {
				next.delete(path)
			} else {
				next.add(path)
			}
			return next
		})
	}

	function expandAll() {
		const paths: string[] = []
		function collect(val: unknown, path: string) {
			if (val !== null && typeof val === 'object') {
				paths.push(path)
				if (Array.isArray(val)) {
					val.forEach((item, i) => collect(item, `${path}[${i}]`))
				} else {
					for (const key of Object.keys(val as Record<string, unknown>)) {
						collect((val as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
					}
				}
			}
		}
		collect(props.value, '$')
		setExpanded(new Set(paths))
	}

	function collapseAll() {
		setExpanded(new Set<string>())
	}

	async function copyToClipboard(text: string, path: string) {
		try {
			await navigator.clipboard.writeText(text)
			setCopiedPath(path)
			setTimeout(() => setCopiedPath(null), 1500)
		} catch {
			// clipboard not available
		}
	}

	// Render the value as-is. Don't auto-parse JSON-looking strings — a JSON
	// scalar that's actually stored as a string in the column needs to be visible
	// as a string leaf, not silently re-interpreted as the array/object it
	// happens to encode.
	const parsedValue = createMemo(() => props.value)

	return (
		<div class="json-tree">
			<div class="json-tree__toolbar">
				<div class="json-tree__search">
					<input
						type="text"
						class="json-tree__search-input"
						placeholder="Filter keys/values..."
						value={searchQuery()}
						onInput={(e) => setSearchQuery(e.currentTarget.value)}
						spellcheck={false}
					/>
					<Show when={searchQuery()}>
						<button
							class="json-tree__search-clear"
							onClick={() => setSearchQuery('')}
						>
							&times;
						</button>
					</Show>
				</div>
				<button class="json-tree__expand-btn" onClick={expandAll} title="Expand all">
					Expand
				</button>
				<button class="json-tree__expand-btn" onClick={collapseAll} title="Collapse all">
					Collapse
				</button>
			</div>
			<div class="json-tree__content">
				<TreeNode
					value={parsedValue()}
					path="$"
					keyName={null}
					depth={0}
					expanded={expanded()}
					onToggle={toggle}
					searchQuery={searchQuery().toLowerCase()}
					onCopyPath={copyToClipboard}
					copiedPath={copiedPath()}
				/>
			</div>
		</div>
	)
}

interface TreeNodeProps {
	value: unknown
	path: string
	keyName: string | number | null
	depth: number
	expanded: Set<string>
	onToggle: (path: string) => void
	searchQuery: string
	onCopyPath: (text: string, id: string) => void
	copiedPath: string | null
}

function formatPath(path: string): string {
	// Convert internal path format to user-friendly: $.key[0].name → data.key[0].name
	return path.replace(/^\$\.?/, '').replace(/^$/, '$')
}

function getValuePreview(value: unknown): string {
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'
	if (typeof value === 'string') return value.length > 80 ? `"${value.slice(0, 80)}..."` : `"${value}"`
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) return `Array(${value.length})`
	if (typeof value === 'object') return `{${Object.keys(value).length} keys}`
	return String(value)
}

function matchesSearch(key: string | number | null, value: unknown, query: string): boolean {
	if (!query) return true
	if (key !== null && String(key).toLowerCase().includes(query)) return true
	if (value !== null && typeof value !== 'object') {
		return String(value).toLowerCase().includes(query)
	}
	return false
}

function subtreeMatchesSearch(key: string | number | null, value: unknown, query: string): boolean {
	if (!query) return true
	if (matchesSearch(key, value, query)) return true
	if (value !== null && typeof value === 'object') {
		if (Array.isArray(value)) {
			return value.some((item, i) => subtreeMatchesSearch(i, item, query))
		}
		return Object.entries(value as Record<string, unknown>).some(
			([k, v]) => subtreeMatchesSearch(k, v, query),
		)
	}
	return false
}

function TreeNode(props: TreeNodeProps) {
	const isExpandable = () => {
		const v = props.value
		return v !== null && v !== undefined && typeof v === 'object'
	}

	const isExpanded = () => props.expanded.has(props.path)

	const entries = createMemo(() => {
		const v = props.value
		if (!isExpandable()) return []
		if (Array.isArray(v)) {
			return v.map((item, i) => ({
				key: i,
				value: item,
				path: `${props.path}[${i}]`,
			}))
		}
		return Object.entries(v as Record<string, unknown>).map(([k, val]) => ({
			key: k,
			value: val,
			path: props.path === '$' ? `$.${k}` : `${props.path}.${k}`,
		}))
	})

	const filteredEntries = createMemo(() => {
		if (!props.searchQuery) return entries()
		return entries().filter((entry) => subtreeMatchesSearch(entry.key, entry.value, props.searchQuery))
	})

	const isArray = () => Array.isArray(props.value)

	const visible = () => {
		if (!props.searchQuery) return true
		return subtreeMatchesSearch(props.keyName, props.value, props.searchQuery)
	}

	const userPath = () => formatPath(props.path)
	const copyId = () => `path:${props.path}`
	const copyValueId = () => `value:${props.path}`

	return (
		<Show when={visible()}>
			<div class="json-tree__node" style={{ '--depth': props.depth }}>
				<div
					class="json-tree__row"
					classList={{
						'json-tree__row--expandable': isExpandable(),
						'json-tree__row--highlight': props.searchQuery !== '' && matchesSearch(props.keyName, props.value, props.searchQuery),
					}}
					onClick={() => isExpandable() && props.onToggle(props.path)}
				>
					<span class="json-tree__indent" style={{ width: `${props.depth * 16}px` }} />
					<Show when={isExpandable()}>
						<span class="json-tree__toggle">
							<Show when={isExpanded()} fallback={<ChevronRight size={12} />}>
								<ChevronDown size={12} />
							</Show>
						</span>
					</Show>
					<Show when={!isExpandable()}>
						<span class="json-tree__toggle-spacer" />
					</Show>

					<Show when={props.keyName !== null}>
						<span class="json-tree__key">
							<Show when={typeof props.keyName === 'number'} fallback={<>{props.keyName}</>}>
								<span class="json-tree__index">{props.keyName}</span>
							</Show>
						</span>
						<span class="json-tree__colon">:</span>
					</Show>

					<Show
						when={isExpandable()}
						fallback={
							<span
								class={`json-tree__value json-tree__value--${
									typeof props.value === 'string' ? 'string' : props.value === null ? 'null' : typeof props.value
								}`}
							>
								{getValuePreview(props.value)}
							</span>
						}
					>
						<span class="json-tree__preview">
							{isArray() ? `[${(props.value as unknown[]).length}]` : `{${Object.keys(props.value as Record<string, unknown>).length}}`}
						</span>
					</Show>

					<span class="json-tree__actions">
						<button
							class="json-tree__copy-btn"
							classList={{ 'json-tree__copy-btn--copied': props.copiedPath === copyId() }}
							onClick={(e) => {
								e.stopPropagation()
								props.onCopyPath(userPath(), copyId())
							}}
							title={`Copy path: ${userPath()}`}
						>
							{props.copiedPath === copyId() ? 'Copied!' : 'Path'}
						</button>
						<button
							class="json-tree__copy-btn"
							classList={{ 'json-tree__copy-btn--copied': props.copiedPath === copyValueId() }}
							onClick={(e) => {
								e.stopPropagation()
								const text = typeof props.value === 'object' && props.value !== null
									? JSON.stringify(props.value, null, 2)
									: String(props.value ?? 'null')
								props.onCopyPath(text, copyValueId())
							}}
							title="Copy value"
						>
							<Copy size={10} />
						</button>
					</span>
				</div>

				<Show when={isExpandable() && isExpanded()}>
					<For each={filteredEntries()}>
						{(entry) => (
							<TreeNode
								value={entry.value}
								path={entry.path}
								keyName={entry.key}
								depth={props.depth + 1}
								expanded={props.expanded}
								onToggle={props.onToggle}
								searchQuery={props.searchQuery}
								onCopyPath={props.onCopyPath}
								copiedPath={props.copiedPath}
							/>
						)}
					</For>
				</Show>
			</div>
		</Show>
	)
}
