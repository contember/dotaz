import type { IndexInfo } from '@dotaz/shared/types/database'
import { For, Show } from 'solid-js'

interface IndexListProps {
	indexes: IndexInfo[]
}

export default function IndexList(props: IndexListProps) {
	return (
		<div class="schema-viewer__section">
			<h3 class="schema-viewer__section-title">Indexes</h3>
			<Show
				when={props.indexes.length > 0}
				fallback={<p class="schema-viewer__empty">No indexes found.</p>}
			>
				<table class="schema-viewer__table">
					<thead>
						<tr>
							<th class="schema-viewer__th">Name</th>
							<th class="schema-viewer__th">Columns</th>
							<th class="schema-viewer__th">Type</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.indexes}>
							{(idx) => (
								<tr class="schema-viewer__row">
									<td class="schema-viewer__td schema-viewer__td--name">{idx.name}</td>
									<td class="schema-viewer__td">
										<code class="schema-viewer__code">{idx.columns.join(', ')}</code>
									</td>
									<td class="schema-viewer__td">
										<Show when={idx.isPrimary}>
											<span class="schema-viewer__badge schema-viewer__badge--primary">PRIMARY</span>
										</Show>
										<Show when={idx.isUnique && !idx.isPrimary}>
											<span class="schema-viewer__badge schema-viewer__badge--unique">UNIQUE</span>
										</Show>
										<Show when={!idx.isUnique && !idx.isPrimary}>
											<span class="schema-viewer__badge">INDEX</span>
										</Show>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Show>
		</div>
	)
}
