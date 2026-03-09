import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import { createSignal, For, Show } from 'solid-js'
import type { ExplainNode, ExplainResult } from '@dotaz/shared/types/query'
import './ExplainPanel.css'

interface ExplainPanelProps {
	result: ExplainResult
}

export default function ExplainPanel(props: ExplainPanelProps) {
	const [showRaw, setShowRaw] = createSignal(false)

	const maxCost = () => {
		let max = 0
		function walk(nodes: ExplainNode[]) {
			for (const n of nodes) {
				if (n.cost != null && n.cost > max) max = n.cost
				if (n.actualTime != null && n.actualTime > max) max = n.actualTime
				walk(n.children)
			}
		}
		walk(props.result.nodes)
		return max || 1
	}

	return (
		<div class="explain-panel">
			<div class="explain-panel__toolbar">
				<button
					class="explain-panel__tab"
					classList={{ 'explain-panel__tab--active': !showRaw() }}
					onClick={() => setShowRaw(false)}
				>
					Tree
				</button>
				<button
					class="explain-panel__tab"
					classList={{ 'explain-panel__tab--active': showRaw() }}
					onClick={() => setShowRaw(true)}
				>
					Raw
				</button>
			</div>

			<Show when={props.result.error}>
				<div class="explain-panel__error">{props.result.error}</div>
			</Show>

			<Show when={!props.result.error}>
				<Show
					when={!showRaw()}
					fallback={<pre class="explain-panel__raw">{props.result.rawText}</pre>}
				>
					<div class="explain-panel__tree">
						<For each={props.result.nodes}>
							{(node) => <ExplainNodeRow node={node} depth={0} maxCost={maxCost()} />}
						</For>
					</div>
				</Show>
			</Show>
		</div>
	)
}

function ExplainNodeRow(props: { node: ExplainNode; depth: number; maxCost: number }) {
	const [expanded, setExpanded] = createSignal(true)
	const hasChildren = () => props.node.children.length > 0
	const costRatio = () => {
		const val = props.node.actualTime ?? props.node.cost ?? 0
		return val / props.maxCost
	}
	const isExpensive = () => costRatio() > 0.5

	return (
		<div class="explain-node">
			<div
				class="explain-node__row"
				classList={{ 'explain-node__row--expensive': isExpensive() }}
				style={{ 'padding-left': `${props.depth * 20 + 4}px` }}
				onClick={() => hasChildren() && setExpanded((e) => !e)}
			>
				<span class="explain-node__toggle">
					<Show when={hasChildren()}>
						{expanded() ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
					</Show>
				</span>

				<span class="explain-node__operation">{props.node.operation}</span>

				<Show when={props.node.relation}>
					<span class="explain-node__relation">on {props.node.relation}</span>
				</Show>

				<span class="explain-node__metrics">
					<Show when={props.node.cost != null}>
						<span class="explain-node__metric" title="Estimated cost">
							cost: {props.node.cost!.toFixed(2)}
						</span>
					</Show>
					<Show when={props.node.actualTime != null}>
						<span class="explain-node__metric" title="Actual time (ms)">
							time: {props.node.actualTime!.toFixed(3)} ms
						</span>
					</Show>
					<Show when={props.node.estimatedRows != null}>
						<span class="explain-node__metric" title="Estimated rows">
							est. rows: {props.node.estimatedRows}
						</span>
					</Show>
					<Show when={props.node.actualRows != null}>
						<span class="explain-node__metric" title="Actual rows">
							rows: {props.node.actualRows}
						</span>
					</Show>
				</span>

				<Show when={costRatio() > 0}>
					<span
						class="explain-node__bar"
						classList={{ 'explain-node__bar--hot': isExpensive() }}
						style={{ width: `${Math.max(costRatio() * 100, 2)}px` }}
					/>
				</Show>
			</div>

			<Show when={expanded() && hasChildren()}>
				<For each={props.node.children}>
					{(child) => <ExplainNodeRow node={child} depth={props.depth + 1} maxCost={props.maxCost} />}
				</For>
			</Show>
		</div>
	)
}
