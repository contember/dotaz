import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { basicSetup } from "codemirror";
import { editorStore } from "../../stores/editor";
import { connectionsStore } from "../../stores/connections";
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

export default function SqlEditor(props: SqlEditorProps) {
	let containerRef: HTMLDivElement | undefined;
	let editorView: EditorView | undefined;
	const [editorHeight, setEditorHeight] = createSignal(DEFAULT_EDITOR_HEIGHT);

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
				sql({ dialect }),
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

	onCleanup(() => {
		editorView?.destroy();
	});

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
			>
				<div ref={containerRef} class="sql-editor__codemirror" />
			</div>
			<div
				class="sql-editor__resize-handle"
				onMouseDown={handleResizeMouseDown}
			/>
		</>
	);
}
