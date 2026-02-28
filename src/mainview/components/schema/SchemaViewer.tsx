import { createSignal, onMount, Show } from "solid-js";
import type { ColumnInfo, IndexInfo, ForeignKeyInfo } from "../../../shared/types/database";
import { rpc } from "../../lib/rpc";
import { tabsStore } from "../../stores/tabs";
import Icon from "../common/Icon";
import ColumnList from "./ColumnList";
import IndexList from "./IndexList";
import "./SchemaViewer.css";

interface SchemaViewerProps {
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
}

export default function SchemaViewer(props: SchemaViewerProps) {
	const [columns, setColumns] = createSignal<ColumnInfo[]>([]);
	const [indexes, setIndexes] = createSignal<IndexInfo[]>([]);
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);

	onMount(async () => {
		try {
			const [cols, idxs, fks] = await Promise.all([
				rpc.schema.getColumns(props.connectionId, props.schema, props.table),
				rpc.schema.getIndexes(props.connectionId, props.schema, props.table),
				rpc.schema.getForeignKeys(props.connectionId, props.schema, props.table),
			]);
			setColumns(cols);
			setIndexes(idxs);
			setForeignKeys(fks);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	});

	function handleFkNavigate(schema: string, table: string) {
		tabsStore.openTab({
			type: "schema-viewer",
			title: `Schema — ${table}`,
			connectionId: props.connectionId,
			schema,
			table,
		});
	}

	function handleOpenData() {
		tabsStore.openTab({
			type: "data-grid",
			title: props.table,
			connectionId: props.connectionId,
			schema: props.schema,
			table: props.table,
		});
	}

	return (
		<div class="schema-viewer">
			<div class="schema-viewer__header">
				<div class="schema-viewer__title">
					<Show when={props.schema !== "main"}>
						<span class="schema-viewer__schema-name">{props.schema}.</span>
					</Show>
					{props.table}
				</div>
				<button
					class="schema-viewer__open-data-btn"
					onClick={handleOpenData}
					title="Open data grid for this table"
				>
					<Icon name="grid" size={12} /> Open Data
				</button>
			</div>

			<Show when={loading()}>
				<div class="schema-viewer__loading">
					<Icon name="spinner" size={14} />
					Loading schema...
				</div>
			</Show>

			<Show when={error()}>
				<div class="schema-viewer__error">
					<Icon name="error" size={14} /> {error()}
				</div>
			</Show>

			<Show when={!loading() && !error()}>
				<div class="schema-viewer__body">
					<ColumnList
						columns={columns()}
						foreignKeys={foreignKeys()}
						onFkClick={handleFkNavigate}
					/>
					<IndexList indexes={indexes()} />
				</div>
			</Show>
		</div>
	);
}
