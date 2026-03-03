import type { JSX } from 'solid-js'
import { For, Show } from 'solid-js'
import Icon from '../common/Icon'
import './ConnectionTree.css'

export type TreeItemType = 'connection' | 'database' | 'schema' | 'table' | 'view'

export interface TreeItemAction {
	icon: JSX.Element
	title: string
	onClick: () => void
}

interface ConnectionTreeItemProps {
	label: string
	level: number
	type: TreeItemType
	icon?: JSX.Element
	expanded?: boolean
	hasChildren?: boolean
	statusColor?: string
	connectionColor?: string
	loading?: boolean
	badge?: JSX.Element
	actions?: TreeItemAction[]
	onClick?: () => void
	onToggle?: () => void
	onContextMenu?: (e: MouseEvent) => void
}

export default function ConnectionTreeItem(props: ConnectionTreeItemProps) {
	function handleClick(e: MouseEvent) {
		e.stopPropagation()
		props.onClick?.()
	}

	function handleToggle(e: MouseEvent) {
		e.stopPropagation()
		props.onToggle?.()
	}

	return (
		<div
			class="tree-item"
			classList={{ 'tree-item--view': props.type === 'view' }}
			style={{
				'padding-left': `${props.level * 16 + 4}px`,
				'border-left': props.connectionColor ? `3px solid ${props.connectionColor}` : undefined,
			}}
			onClick={handleClick}
			onContextMenu={props.onContextMenu}
		>
			<Show when={props.hasChildren} fallback={<span class="tree-item__arrow-spacer" />}>
				<button class="tree-item__arrow" onClick={handleToggle}>
					<span
						class="tree-item__arrow-icon"
						classList={{ 'tree-item__arrow-icon--expanded': props.expanded }}
					>
						<Icon name="chevron-right" size={10} />
					</span>
				</button>
			</Show>

			<Show when={props.loading}>
				<Icon name="spinner" size={12} />
			</Show>

			<Show when={!props.loading && props.icon}>
				<span class="tree-item__icon">{props.icon}</span>
			</Show>

			<span class="tree-item__label">{props.label}</span>

			<Show when={props.badge}>
				{props.badge}
			</Show>

			<Show when={props.actions && props.actions.length > 0}>
				<span class="tree-item__actions">
					<For each={props.actions}>
						{(action) => (
							<button
								class="tree-item__action"
								title={action.title}
								onClick={(e) => {
									e.stopPropagation()
									action.onClick()
								}}
							>
								{action.icon}
							</button>
						)}
					</For>
				</span>
			</Show>

			<Show when={props.statusColor}>
				<span
					class="tree-item__status"
					style={{ color: props.statusColor }}
				>
					&#x25CF;
				</span>
			</Show>
		</div>
	)
}
