import { For, Show } from "solid-js";
import type { ColumnInfo, ForeignKeyInfo } from "../../../shared/types/database";

interface ColumnListProps {
	columns: ColumnInfo[];
	foreignKeys: ForeignKeyInfo[];
	onFkClick: (schema: string, table: string) => void;
}

/** Build a map from source column name → FK info for single-column FKs. */
function buildFkLookup(foreignKeys: ForeignKeyInfo[]): Map<string, ForeignKeyInfo> {
	const map = new Map<string, ForeignKeyInfo>();
	for (const fk of foreignKeys) {
		if (fk.columns.length === 1) {
			map.set(fk.columns[0], fk);
		}
	}
	return map;
}

export default function ColumnList(props: ColumnListProps) {
	const fkLookup = () => buildFkLookup(props.foreignKeys);

	return (
		<div class="schema-viewer__section">
			<h3 class="schema-viewer__section-title">Columns</h3>
			<table class="schema-viewer__table">
				<thead>
					<tr>
						<th class="schema-viewer__th schema-viewer__th--icon" />
						<th class="schema-viewer__th">Name</th>
						<th class="schema-viewer__th">Type</th>
						<th class="schema-viewer__th schema-viewer__th--center">Nullable</th>
						<th class="schema-viewer__th">Default</th>
						<th class="schema-viewer__th">Foreign Key</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.columns}>
						{(col) => {
							const fk = () => fkLookup().get(col.name);
							return (
								<tr class="schema-viewer__row">
									<td class="schema-viewer__td schema-viewer__td--icon">
										<Show when={col.isPrimaryKey}>
											<span class="schema-viewer__pk-icon" title="Primary Key">&#128273;</span>
										</Show>
										<Show when={fk()}>
											<span class="schema-viewer__fk-icon" title="Foreign Key">&#8594;</span>
										</Show>
									</td>
									<td class="schema-viewer__td schema-viewer__td--name">
										{col.name}
										<Show when={col.isAutoIncrement}>
											<span class="schema-viewer__auto-increment" title="Auto Increment">AI</span>
										</Show>
									</td>
									<td class="schema-viewer__td schema-viewer__td--type">
										{col.dataType}
										<Show when={col.maxLength != null}>
											<span class="schema-viewer__max-length">({col.maxLength})</span>
										</Show>
									</td>
									<td class="schema-viewer__td schema-viewer__td--center">
										<Show when={col.nullable} fallback={<span class="schema-viewer__not-null" title="NOT NULL">&#10005;</span>}>
											<span class="schema-viewer__nullable" title="Nullable">&#10003;</span>
										</Show>
									</td>
									<td class="schema-viewer__td schema-viewer__td--default">
										<Show when={col.defaultValue != null}>
											<code class="schema-viewer__code">{col.defaultValue}</code>
										</Show>
									</td>
									<td class="schema-viewer__td">
										<Show when={fk()}>
											{(fkInfo) => (
												<button
													class="schema-viewer__fk-link"
													onClick={() =>
														props.onFkClick(fkInfo().referencedSchema, fkInfo().referencedTable)
													}
													title={`${fkInfo().referencedTable}.${fkInfo().referencedColumns[0]}`}
												>
													{fkInfo().referencedTable}.{fkInfo().referencedColumns[0]}
												</button>
											)}
										</Show>
									</td>
								</tr>
							);
						}}
					</For>
				</tbody>
			</table>
		</div>
	);
}
