import { onMount, onCleanup, createSignal, createEffect, Show } from "solid-js";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { sql, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { basicSetup } from "codemirror";
import { editorStore } from "../../stores/editor";
import { connectionsStore } from "../../stores/connections";
import { rpc } from "../../lib/rpc";
import ContextMenu from "../common/ContextMenu";
import type { ContextMenuEntry } from "../common/ContextMenu";
import "./SqlEditor.css";

interface SqlEditorProps {
	tabId: string;
	connectionId: string;
}

const MIN_EDITOR_HEIGHT = 60;
const DEFAULT_EDITOR_HEIGHT = 200;

function createDarkTheme() {
	return EditorView.theme(
		{
			"&": {
				backgroundColor: "var(--bg-panel)",
				color: "var(--text-primary)",
				fontSize: "var(--font-size-base)",
				fontFamily: "var(--font-mono)",
			},
			".cm-content": {
				caretColor: "var(--text-primary)",
				fontFamily: "var(--font-mono)",
			},
			".cm-cursor, .cm-dropCursor": {
				borderLeftColor: "var(--text-primary)",
			},
			"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
				{
					backgroundColor: "var(--bg-selection)",
				},
			".cm-panels": {
				backgroundColor: "var(--bg-panel)",
				color: "var(--text-primary)",
			},
			".cm-panels.cm-panels-top": {
				borderBottom: "1px solid var(--border-color)",
			},
			".cm-panels.cm-panels-bottom": {
				borderTop: "1px solid var(--border-color)",
			},
			".cm-searchMatch": {
				backgroundColor: "rgba(255, 213, 0, 0.2)",
				outline: "1px solid rgba(255, 213, 0, 0.4)",
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: "rgba(255, 213, 0, 0.4)",
			},
			".cm-activeLine": {
				backgroundColor: "var(--bg-hover)",
			},
			".cm-selectionMatch": {
				backgroundColor: "rgba(255, 255, 255, 0.1)",
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket":
				{
					backgroundColor: "rgba(255, 255, 255, 0.1)",
					outline: "1px solid rgba(255, 255, 255, 0.3)",
				},
			".cm-gutters": {
				backgroundColor: "var(--bg-panel)",
				color: "var(--text-muted)",
				border: "none",
				borderRight: "1px solid var(--border-color)",
			},
			".cm-activeLineGutter": {
				backgroundColor: "var(--bg-hover)",
				color: "var(--text-secondary)",
			},
			".cm-foldPlaceholder": {
				backgroundColor: "transparent",
				border: "none",
				color: "var(--text-muted)",
			},
			".cm-tooltip": {
				backgroundColor: "var(--bg-panel)",
				border: "1px solid var(--border-color)",
				color: "var(--text-primary)",
			},
			".cm-tooltip .cm-tooltip-arrow:before": {
				borderTopColor: "transparent",
				borderBottomColor: "transparent",
			},
			".cm-tooltip .cm-tooltip-arrow:after": {
				borderTopColor: "var(--bg-panel)",
				borderBottomColor: "var(--bg-panel)",
			},
			".cm-tooltip-autocomplete": {
				"& > ul > li[aria-selected]": {
					backgroundColor: "var(--bg-selection)",
					color: "var(--text-primary)",
				},
			},
			".cm-placeholder": {
				color: "var(--text-muted)",
				fontStyle: "italic",
			},
		},
		{ dark: true },
	);
}

function getDialect(connectionId: string) {
	const conn = connectionsStore.connections.find(
		(c) => c.id === connectionId,
	);
	if (conn?.config.type === "sqlite") return SQLite;
	return PostgreSQL;
}

function isSqliteConnection(connectionId: string): boolean {
	const conn = connectionsStore.connections.find(
		(c) => c.id === connectionId,
	);
	return conn?.config.type === "sqlite";
}

async function buildSchemaSpec(
	connectionId: string,
): Promise<Record<string, readonly string[]>> {
	const tree = connectionsStore.getSchemaTree(connectionId);
	if (!tree) return {};

	const sqlite = isSqliteConnection(connectionId);
	const spec: Record<string, string[]> = {};

	const fetchPromises: Promise<void>[] = [];

	for (const schema of tree.schemas) {
		const tables = tree.tables[schema.name] || [];
		for (const table of tables) {
			fetchPromises.push(
				rpc.schema
					.getColumns(connectionId, schema.name, table.name)
					.then((columns) => {
						const key = sqlite
							? table.name
							: `${schema.name}.${table.name}`;
						spec[key] = columns.map((c) => c.name);
					})
					.catch(() => {
						const key = sqlite
							? table.name
							: `${schema.name}.${table.name}`;
						spec[key] = [];
					}),
			);
		}
	}

	await Promise.all(fetchPromises);
	return spec;
}

export default function SqlEditor(props: SqlEditorProps) {
	let containerRef: HTMLDivElement | undefined;
	let editorView: EditorView | undefined;
	const sqlCompartment = new Compartment();
	const [editorHeight, setEditorHeight] = createSignal(DEFAULT_EDITOR_HEIGHT);
	const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number } | null>(null);
	// Snapshot editor selection at right-click time (editor loses focus when menu opens)
	let ctxSelection = { from: 0, to: 0 };

	onMount(() => {
		if (!containerRef) return;

		editorStore.initTab(props.tabId, props.connectionId);
		const tab = editorStore.getTab(props.tabId);
		const initialContent = tab?.content ?? "";
		const dialect = getDialect(props.connectionId);

		const executeKeymap = keymap.of([
			{
				key: "Ctrl-Enter",
				mac: "Cmd-Enter",
				run: () => {
					editorStore.executeQuery(props.tabId);
					return true;
				},
			},
			{
				key: "Ctrl-Shift-Enter",
				mac: "Cmd-Shift-Enter",
				run: (view) => {
					const selection = view.state.sliceDoc(
						view.state.selection.main.from,
						view.state.selection.main.to,
					);
					if (selection) {
						editorStore.executeSelected(props.tabId, selection);
					} else {
						editorStore.executeQuery(props.tabId);
					}
					return true;
				},
			},
		]);

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const content = update.state.doc.toString();
				editorStore.setContent(props.tabId, content);
			}
			if (update.selectionSet) {
				const { from, to } = update.state.selection.main;
				const selected = from !== to ? update.state.sliceDoc(from, to) : "";
				editorStore.setSelectedText(props.tabId, selected);
			}
		});

		const state = EditorState.create({
			doc: initialContent,
			extensions: [
				basicSetup,
				sqlCompartment.of(sql({ dialect })),
				createDarkTheme(),
				executeKeymap,
				updateListener,
				placeholder("Write your SQL query here..."),
				EditorView.lineWrapping,
			],
		});

		editorView = new EditorView({
			state,
			parent: containerRef,
		});
	});

	// Sync external content changes into editor (e.g. format)
	createEffect(() => {
		const tab = editorStore.getTab(props.tabId);
		if (!tab || !editorView) return;

		const editorContent = editorView.state.doc.toString();
		if (tab.content !== editorContent) {
			editorView.dispatch({
				changes: {
					from: 0,
					to: editorView.state.doc.length,
					insert: tab.content,
				},
			});
		}
	});

	// Reconfigure SQL extension with schema-aware completions
	let schemaVersion = 0;
	createEffect(() => {
		// Access schema tree reactively — triggers when it changes
		const tree = connectionsStore.getSchemaTree(props.connectionId);
		if (!tree || !editorView) return;

		const version = ++schemaVersion;
		const dialect = getDialect(props.connectionId);
		const sqlite = isSqliteConnection(props.connectionId);

		buildSchemaSpec(props.connectionId).then((schema) => {
			// Guard against stale results from earlier schema tree versions
			if (version !== schemaVersion || !editorView) return;

			editorView.dispatch({
				effects: sqlCompartment.reconfigure(
					sql({
						dialect,
						schema,
						defaultSchema: sqlite ? undefined : "public",
					}),
				),
			});
		});
	});

	onCleanup(() => {
		editorView?.destroy();
	});

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		if (editorView) {
			const sel = editorView.state.selection.main;
			ctxSelection = { from: sel.from, to: sel.to };
		}
		setCtxMenu({ x: e.clientX, y: e.clientY });
	}

	function getSelectedText(): string {
		if (ctxSelection.from === ctxSelection.to) return "";
		return editorView?.state.sliceDoc(ctxSelection.from, ctxSelection.to) ?? "";
	}

	function formatSqlValue(value: unknown): string {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "number") return String(value);
		if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
		if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
		return `'${String(value).replace(/'/g, "''")}'`;
	}

	function buildInsertStatements(): string {
		const tab = editorStore.getTab(props.tabId);
		if (!tab || tab.results.length === 0) return "";
		const result = tab.results[0];
		if (!result.columns || result.columns.length === 0 || result.rows.length === 0) return "";
		const colNames = result.columns.map((c) => `"${c.name}"`).join(", ");
		return result.rows
			.map((row) => {
				const vals = result.columns.map((c) => formatSqlValue(row[c.name])).join(", ");
				return `INSERT INTO table_name (${colNames}) VALUES (${vals});`;
			})
			.join("\n");
	}

	const contextMenuItems = (): ContextMenuEntry[] => {
		const hasSelection = ctxSelection.from !== ctxSelection.to;
		const tab = editorStore.getTab(props.tabId);
		const hasResults = (tab?.results.length ?? 0) > 0 && (tab?.results[0]?.rows.length ?? 0) > 0;

		return [
			{
				label: "Cut",
				action: async () => {
					const text = getSelectedText();
					if (text && editorView) {
						await navigator.clipboard.writeText(text);
						editorView.dispatch({
							changes: { from: ctxSelection.from, to: ctxSelection.to, insert: "" },
						});
						editorView.focus();
					}
				},
				disabled: !hasSelection,
			},
			{
				label: "Copy",
				action: async () => {
					const text = getSelectedText();
					if (text) {
						await navigator.clipboard.writeText(text);
					}
				},
				disabled: !hasSelection,
			},
			{
				label: "Paste",
				action: async () => {
					if (!editorView) return;
					const text = await navigator.clipboard.readText();
					editorView.dispatch({
						changes: { from: ctxSelection.from, to: ctxSelection.to, insert: text },
					});
					editorView.focus();
				},
			},
			{
				label: "Select All",
				action: () => {
					if (!editorView) return;
					editorView.dispatch({
						selection: { anchor: 0, head: editorView.state.doc.length },
					});
					editorView.focus();
				},
			},
			"separator",
			{
				label: "Run Selected",
				action: () => {
					const text = getSelectedText();
					if (text) {
						editorStore.executeSelected(props.tabId, text);
					} else {
						editorStore.executeQuery(props.tabId);
					}
				},
			},
			{
				label: "Format SQL",
				action: () => editorStore.formatSql(props.tabId),
			},
			"separator",
			{
				label: "Copy as INSERT",
				action: async () => {
					const sql = buildInsertStatements();
					if (sql) {
						await navigator.clipboard.writeText(sql);
					}
				},
				disabled: !hasResults,
			},
		];
	};

	function handleResizeMouseDown(e: MouseEvent) {
		e.preventDefault();
		let lastY = e.clientY;

		const onMouseMove = (e: MouseEvent) => {
			const delta = e.clientY - lastY;
			lastY = e.clientY;
			setEditorHeight((h) => Math.max(MIN_EDITOR_HEIGHT, h + delta));
		};

		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};

		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
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
	);
}
