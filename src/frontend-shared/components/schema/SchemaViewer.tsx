import { createMemo, Show } from "solid-js";
import type { ColumnInfo, IndexInfo, ForeignKeyInfo } from "../../../shared/types/database";
import { connectionsStore } from "../../stores/connections";
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
	database?: string;
}

export default function SchemaViewer(props: SchemaViewerProps) {
	const columns = createMemo<ColumnInfo[]>(() =>
		connectionsStore.getColumns(props.connectionId, props.schema, props.table, props.database),
	);
	const indexes = createMemo<IndexInfo[]>(() =>
		connectionsStore.getIndexes(props.connectionId, props.schema, props.table, props.database),
	);
	const foreignKeys = createMemo<ForeignKeyInfo[]>(() =>
		connectionsStore.getForeignKeys(props.connectionId, props.schema, props.table, props.database),
	);

	const hasData = createMemo(() => columns().length > 0);

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

			<Show when={!hasData()}>
				<div class="schema-viewer__loading">
					<Icon name="spinner" size={14} />
					Loading schema...
				</div>
			</Show>

			<Show when={hasData()}>
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
