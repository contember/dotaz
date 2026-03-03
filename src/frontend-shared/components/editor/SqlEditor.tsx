import { MySQL, PostgreSQL, sql, SQLite } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { ConnectionType } from '../../../shared/types/connection'
import { CONNECTION_TYPE_META } from '../../../shared/types/connection'
import { commandRegistry } from '../../lib/commands'
import { createJoinCompletionSource } from '../../lib/join-completion'
import { MIN_EDITOR_HEIGHT } from '../../lib/layout-constants'
import { getNextStatementStart, getPreviousStatementStart } from '../../lib/sql-utils'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import ContextMenu from '../common/ContextMenu'
import type { ContextMenuEntry } from '../common/ContextMenu'
import './SqlEditor.css'

interface SqlEditorProps {
	tabId: string
	connectionId: string
	database?: string
}

const DEFAULT_EDITOR_HEIGHT = 200

function createDarkTheme() {
	return EditorView.theme(
		{
			'&': {
				backgroundColor: 'var(--surface-raised)',
				color: 'var(--ink)',
				fontSize: 'var(--font-size-base)',
				fontFamily: 'var(--font-mono)',
			},
			'.cm-content': {
				caretColor: 'var(--ink)',
				fontFamily: 'var(--font-mono)',
			},
			'.cm-cursor, .cm-dropCursor': {
				borderLeftColor: 'var(--ink)',
			},
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
				backgroundColor: 'var(--surface-selected)',
			},
			'.cm-panels': {
				backgroundColor: 'var(--surface-raised)',
				color: 'var(--ink)',
			},
			'.cm-panels.cm-panels-top': {
				borderBottom: '1px solid var(--edge)',
			},
			'.cm-panels.cm-panels-bottom': {
				borderTop: '1px solid var(--edge)',
			},
			'.cm-searchMatch': {
				backgroundColor: 'rgba(255, 213, 0, 0.2)',
				outline: '1px solid rgba(255, 213, 0, 0.4)',
			},
			'.cm-searchMatch.cm-searchMatch-selected': {
				backgroundColor: 'rgba(255, 213, 0, 0.4)',
			},
			'.cm-activeLine': {
				backgroundColor: 'var(--surface-hover)',
			},
			'.cm-selectionMatch': {
				backgroundColor: 'rgba(255, 255, 255, 0.1)',
			},
			'&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
				backgroundColor: 'rgba(255, 255, 255, 0.1)',
				outline: '1px solid rgba(255, 255, 255, 0.3)',
			},
			'.cm-gutters': {
				backgroundColor: 'var(--surface-raised)',
				color: 'var(--ink-muted)',
				border: 'none',
				borderRight: '1px solid var(--edge)',
			},
			'.cm-activeLineGutter': {
				backgroundColor: 'var(--surface-hover)',
				color: 'var(--ink-secondary)',
			},
			'.cm-foldPlaceholder': {
				backgroundColor: 'transparent',
				border: 'none',
				color: 'var(--ink-muted)',
			},
			'.cm-tooltip': {
				backgroundColor: 'var(--surface-overlay)',
				border: '1px solid var(--edge-strong)',
				color: 'var(--ink)',
			},
			'.cm-tooltip .cm-tooltip-arrow:before': {
				borderTopColor: 'transparent',
				borderBottomColor: 'transparent',
			},
			'.cm-tooltip .cm-tooltip-arrow:after': {
				borderTopColor: 'var(--surface-overlay)',
				borderBottomColor: 'var(--surface-overlay)',
			},
			'.cm-tooltip-autocomplete': {
				'& > ul > li[aria-selected]': {
					backgroundColor: 'var(--surface-selected)',
					color: 'var(--ink)',
				},
			},
			'.cm-placeholder': {
				color: 'var(--ink-muted)',
				fontStyle: 'italic',
			},
		},
		{ dark: true },
	)
}

const darkHighlightStyle = HighlightStyle.define([
	{ tag: tags.keyword, color: '#c792ea' },
	{ tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#d1d5db' },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#dcdcaa' },
	{ tag: [tags.propertyName], color: '#82aaff' },
	{ tag: [tags.typeName, tags.className, tags.namespace, tags.changed, tags.annotation, tags.self, tags.modifier], color: '#82aaff' },
	{ tag: [tags.number, tags.bool, tags.null], color: '#f5c06f' },
	{ tag: [tags.string, tags.special(tags.brace)], color: '#a5d6a7' },
	{ tag: tags.operator, color: '#89ddff' },
	{ tag: [tags.definitionKeyword, tags.moduleKeyword], color: '#c792ea' },
	{ tag: tags.comment, color: '#636d83', fontStyle: 'italic' },
	{ tag: tags.invalid, color: '#ef4444' },
	{ tag: tags.punctuation, color: '#89ddff' },
])

// ── Executed statement flash highlight ────────────────────

const setExecutedHighlight = StateEffect.define<{ from: number; to: number } | null>()

const executedHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setExecutedHighlight)) {
				if (effect.value) {
					const mark = Decoration.mark({ class: 'cm-executed-statement' })
					return Decoration.set([mark.range(effect.value.from, effect.value.to)])
				}
				return Decoration.none
			}
		}
		return value
	},
	provide: (f) => EditorView.decorations.from(f),
})

// ── SQL error position highlight ──────────────────────────

const setErrorHighlight = StateEffect.define<{ from: number; to: number } | null>()

const errorHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none
	},
	update(value, tr) {
		// Clear error highlight on doc changes
		if (tr.docChanged) return Decoration.none
		for (const effect of tr.effects) {
			if (effect.is(setErrorHighlight)) {
				if (effect.value) {
					const mark = Decoration.mark({ class: 'cm-error-highlight' })
					return Decoration.set([mark.range(effect.value.from, effect.value.to)])
				}
				return Decoration.none
			}
		}
		return value
	},
	provide: (f) => EditorView.decorations.from(f),
})

const DIALECT_MAP: Record<ConnectionType, typeof PostgreSQL> = {
	postgresql: PostgreSQL,
	sqlite: SQLite,
	mysql: MySQL,
}

function getDialect(connectionId: string) {
	const conn = connectionsStore.connections.find(
		(c) => c.id === connectionId,
	)
	return conn ? DIALECT_MAP[conn.config.type] : PostgreSQL
}

function isSingleSchemaConnection(connectionId: string): boolean {
	const conn = connectionsStore.connections.find(
		(c) => c.id === connectionId,
	)
	if (!conn) return false
	return !CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase
}

function buildSchemaSpec(
	connectionId: string,
	database?: string,
): Record<string, readonly string[]> {
	const schemaData = connectionsStore.getSchemaData(connectionId, database)
	if (!schemaData) return {}

	const sqlite = isSingleSchemaConnection(connectionId)
	const spec: Record<string, string[]> = {}

	for (const schema of schemaData.schemas) {
		const tables = schemaData.tables[schema.name] || []
		for (const table of tables) {
			const tableKey = `${schema.name}.${table.name}`
			const columns = schemaData.columns[tableKey] || []
			const key = sqlite ? table.name : tableKey
			spec[key] = columns.map((c) => c.name)
		}
	}

	return spec
}

export default function SqlEditor(props: SqlEditorProps) {
	let containerRef: HTMLDivElement | undefined
	let editorView: EditorView | undefined
	const sqlCompartment = new Compartment()
	const [editorHeight, setEditorHeight] = createSignal(DEFAULT_EDITOR_HEIGHT)
	const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number } | null>(null)
	// Snapshot editor selection at right-click time (editor loses focus when menu opens)
	let ctxSelection = { from: 0, to: 0 }

	onMount(() => {
		if (!containerRef) return

		editorStore.initTab(props.tabId, props.connectionId)
		const tab = editorStore.getTab(props.tabId)
		const initialContent = tab?.content ?? ''
		const dialect = getDialect(props.connectionId)

		const executeKeymap = keymap.of([
			{
				key: 'Ctrl-Enter',
				mac: 'Cmd-Enter',
				run: () => {
					editorStore.executeQuery(props.tabId)
					return true
				},
			},
			{
				key: 'Ctrl-Shift-Enter',
				mac: 'Cmd-Shift-Enter',
				run: () => {
					editorStore.executeStatement(props.tabId)
					return true
				},
			},
			{
				key: 'Ctrl-e',
				mac: 'Cmd-e',
				run: () => {
					editorStore.explainQuery(props.tabId, false)
					return true
				},
			},
			{
				key: 'Ctrl-Shift-e',
				mac: 'Cmd-Shift-e',
				run: () => {
					editorStore.explainQuery(props.tabId, true)
					return true
				},
			},
		])

		const navigationKeymap = Prec.highest(keymap.of([
			{
				key: 'Alt-ArrowDown',
				run: (view) => {
					const text = view.state.doc.toString()
					const cursor = view.state.selection.main.head
					const nextPos = getNextStatementStart(text, cursor)
					if (nextPos == null) return true
					view.dispatch({
						selection: { anchor: nextPos },
						scrollIntoView: true,
					})
					return true
				},
			},
			{
				key: 'Alt-ArrowUp',
				run: (view) => {
					const text = view.state.doc.toString()
					const cursor = view.state.selection.main.head
					const prevPos = getPreviousStatementStart(text, cursor)
					if (prevPos == null) return true
					view.dispatch({
						selection: { anchor: prevPos },
						scrollIntoView: true,
					})
					return true
				},
			},
		]))

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const content = update.state.doc.toString()
				editorStore.setContent(props.tabId, content)
			}
			if (update.selectionSet || update.docChanged) {
				const { from, to } = update.state.selection.main
				const selected = from !== to ? update.state.sliceDoc(from, to) : ''
				editorStore.setSelectedText(props.tabId, selected)
				editorStore.setCursorPosition(props.tabId, from)
			}
		})

		const sqlite = isSingleSchemaConnection(props.connectionId)
		const joinCompletionSource = createJoinCompletionSource(
			props.connectionId,
			props.database,
			sqlite,
		)
		const joinCompletionExtension = EditorState.languageData.of(() => [
			{ autocomplete: joinCompletionSource },
		])

		// Alt+Click to add cursor at clicked position (multi-cursor support)
		const altClickCursor = EditorView.domEventHandlers({
			mousedown(event: MouseEvent, view: EditorView) {
				if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
					const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
					if (pos != null) {
						const ranges = [...view.state.selection.ranges, EditorSelection.cursor(pos)]
						view.dispatch({
							selection: EditorSelection.create(ranges, ranges.length - 1),
						})
						event.preventDefault()
						return true
					}
				}
				return false
			},
		})

		const state = EditorState.create({
			doc: initialContent,
			extensions: [
				basicSetup,
				sqlCompartment.of(sql({ dialect })),
				createDarkTheme(),
				syntaxHighlighting(darkHighlightStyle),
				altClickCursor,
				navigationKeymap,
				executeKeymap,
				updateListener,
				executedHighlightField,
				errorHighlightField,
				joinCompletionExtension,
				placeholder('Write your SQL query here...'),
				EditorView.lineWrapping,
			],
		})

		editorView = new EditorView({
			state,
			parent: containerRef,
		})
	})

	// Sync external content changes into editor (e.g. format)
	createEffect(() => {
		const tab = editorStore.getTab(props.tabId)
		if (!tab || !editorView) return

		const editorContent = editorView.state.doc.toString()
		if (tab.content !== editorContent) {
			editorView.dispatch({
				changes: {
					from: 0,
					to: editorView.state.doc.length,
					insert: tab.content,
				},
			})
		}
	})

	// Reconfigure SQL extension with schema-aware completions
	createEffect(() => {
		// Access schema tree reactively — triggers when it changes
		const tree = connectionsStore.getSchemaTree(props.connectionId, props.database)
		if (!tree || !editorView) return

		const dialect = getDialect(props.connectionId)
		const sqlite = isSingleSchemaConnection(props.connectionId)

		const schema = buildSchemaSpec(props.connectionId, props.database)

		editorView.dispatch({
			effects: sqlCompartment.reconfigure(
				sql({
					dialect,
					schema,
					defaultSchema: sqlite ? undefined : 'public',
				}),
			),
		})
	})

	// Flash highlight when a statement is executed
	let highlightTimer: ReturnType<typeof setTimeout> | undefined
	createEffect(() => {
		const tab = editorStore.getTab(props.tabId)
		const range = tab?.executedRange
		if (!range || !editorView) return

		editorView.dispatch({
			effects: setExecutedHighlight.of(range),
		})

		clearTimeout(highlightTimer)
		highlightTimer = setTimeout(() => {
			editorView?.dispatch({
				effects: setExecutedHighlight.of(null),
			})
		}, 1500)
	})

	// Show/clear error position highlight
	createEffect(() => {
		const tab = editorStore.getTab(props.tabId)
		const offset = tab?.errorOffset
		if (!editorView) return

		if (offset == null) {
			editorView.dispatch({ effects: setErrorHighlight.of(null) })
			return
		}

		const docLen = editorView.state.doc.length
		const from = Math.min(offset, docLen)
		// Highlight the rest of the line from the error position
		const line = editorView.state.doc.lineAt(from)
		const to = Math.min(line.to, docLen)
		// Ensure a visible range (at least 1 char if possible)
		const end = to > from ? to : Math.min(from + 1, docLen)

		editorView.dispatch({ effects: setErrorHighlight.of({ from, to: end }) })
	})

	onCleanup(() => {
		clearTimeout(highlightTimer)
		editorView?.destroy()
	})

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault()
		if (editorView) {
			const sel = editorView.state.selection.main
			ctxSelection = { from: sel.from, to: sel.to }
		}
		setCtxMenu({ x: e.clientX, y: e.clientY })
	}

	function getSelectedText(): string {
		if (ctxSelection.from === ctxSelection.to) return ''
		return editorView?.state.sliceDoc(ctxSelection.from, ctxSelection.to) ?? ''
	}

	function formatSqlValue(value: unknown): string {
		if (value === null || value === undefined) return 'NULL'
		if (typeof value === 'number') return String(value)
		if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
		if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
		return `'${String(value).replace(/'/g, "''")}'`
	}

	function buildInsertStatements(): string {
		const tab = editorStore.getTab(props.tabId)
		if (!tab || tab.results.length === 0) return ''
		const result = tab.results[0]
		if (!result.columns || result.columns.length === 0 || result.rows.length === 0) return ''
		const colNames = result.columns.map((c) => `"${c.name}"`).join(', ')
		return result.rows
			.map((row) => {
				const vals = result.columns.map((c) => formatSqlValue(row[c.name])).join(', ')
				return `INSERT INTO table_name (${colNames}) VALUES (${vals});`
			})
			.join('\n')
	}

	const contextMenuItems = (): ContextMenuEntry[] => {
		const hasSelection = ctxSelection.from !== ctxSelection.to
		const tab = editorStore.getTab(props.tabId)
		const hasContent = (tab?.content.trim().length ?? 0) > 0
		const hasResults = (tab?.results.length ?? 0) > 0 && (tab?.results[0]?.rows.length ?? 0) > 0

		return [
			{
				label: 'Cut',
				action: async () => {
					const text = getSelectedText()
					if (text && editorView) {
						await navigator.clipboard.writeText(text)
						editorView.dispatch({
							changes: { from: ctxSelection.from, to: ctxSelection.to, insert: '' },
						})
						editorView.focus()
					}
				},
				disabled: !hasSelection,
			},
			{
				label: 'Copy',
				action: async () => {
					const text = getSelectedText()
					if (text) {
						await navigator.clipboard.writeText(text)
					}
				},
				disabled: !hasSelection,
			},
			{
				label: 'Paste',
				action: async () => {
					if (!editorView) return
					const text = await navigator.clipboard.readText()
					editorView.dispatch({
						changes: { from: ctxSelection.from, to: ctxSelection.to, insert: text },
					})
					editorView.focus()
				},
			},
			{
				label: 'Select All',
				action: () => {
					if (!editorView) return
					editorView.dispatch({
						selection: { anchor: 0, head: editorView.state.doc.length },
					})
					editorView.focus()
				},
			},
			'separator',
			{
				label: 'Run Statement',
				action: () => {
					editorStore.executeStatement(props.tabId)
				},
			},
			{
				label: 'Format SQL',
				action: () => editorStore.formatSql(props.tabId),
			},
			{
				label: 'Bookmark Query',
				action: () => commandRegistry.execute('bookmark-query'),
				disabled: !hasContent,
			},
			'separator',
			{
				label: 'Copy as INSERT',
				action: async () => {
					const sql = buildInsertStatements()
					if (sql) {
						await navigator.clipboard.writeText(sql)
					}
				},
				disabled: !hasResults,
			},
		]
	}

	function handleResizeMouseDown(e: MouseEvent) {
		e.preventDefault()
		let lastY = e.clientY

		const onMouseMove = (e: MouseEvent) => {
			const delta = e.clientY - lastY
			lastY = e.clientY
			setEditorHeight((h) => Math.max(MIN_EDITOR_HEIGHT, h + delta))
		}

		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mouseup', onMouseUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
		}

		document.body.style.cursor = 'row-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mouseup', onMouseUp)
	}

	return (
		<>
			<div
				class="sql-editor"
				style={{ height: `${editorHeight()}px` }}
				onContextMenu={handleContextMenu}
			>
				<div ref={containerRef} class="sql-editor__codemirror" />
			</div>
			<div
				class="sql-editor__resize-handle"
				onMouseDown={handleResizeMouseDown}
			/>

			<Show when={ctxMenu()}>
				{(menu) => (
					<ContextMenu
						x={menu().x}
						y={menu().y}
						items={contextMenuItems()}
						onClose={() => setCtxMenu(null)}
					/>
				)}
			</Show>
		</>
	)
}
