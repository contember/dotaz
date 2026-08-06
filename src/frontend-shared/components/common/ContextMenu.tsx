import ChevronRight from 'lucide-solid/icons/chevron-right'
import { For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import './ContextMenu.css'

export interface ContextMenuItem {
	label: string
	icon?: () => JSX.Element
	action: () => void
	disabled?: boolean
}

export interface ContextMenuButtonRow {
	type: 'button-row'
	buttons: Array<{
		label: string
		icon?: () => JSX.Element
		action: () => void
		disabled?: boolean
		active?: boolean
	}>
}

export interface ContextMenuLabel {
	type: 'label'
	label: string
}

export interface ContextMenuSubmenu {
	type: 'submenu'
	label: string
	icon?: () => JSX.Element
	items: ContextMenuEntry[]
	disabled?: boolean
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuButtonRow | ContextMenuLabel | ContextMenuSubmenu | 'separator'

interface ContextMenuProps {
	x: number
	y: number
	items: ContextMenuEntry[]
	onClose: () => void
}

function positionSubmenu(submenu: HTMLDivElement) {
	const viewportGap = 4
	let top = -5

	submenu.style.left = 'calc(100% + 4px)'
	submenu.style.right = 'auto'
	submenu.style.top = `${top}px`

	let rect = submenu.getBoundingClientRect()
	if (rect.right > window.innerWidth - viewportGap) {
		submenu.style.left = 'auto'
		submenu.style.right = 'calc(100% + 4px)'
		rect = submenu.getBoundingClientRect()
	}

	if (rect.bottom > window.innerHeight - viewportGap) {
		top -= rect.bottom - window.innerHeight + viewportGap
		submenu.style.top = `${top}px`
		rect = submenu.getBoundingClientRect()
	}
	if (rect.top < viewportGap) {
		top += viewportGap - rect.top
		submenu.style.top = `${top}px`
	}
}

function ContextMenuIcon(props: { icon?: () => JSX.Element }) {
	return (
		<Show when={props.icon}>
			{(icon) => <span class="context-menu__icon">{icon()()}</span>}
		</Show>
	)
}

function ContextMenuEntries(props: { items: ContextMenuEntry[]; onSelect: () => void }) {
	return (
		<For each={props.items}>
			{(item) => {
				if (item === 'separator') {
					return <div class="context-menu__separator" />
				}
				if ('type' in item) {
					switch (item.type) {
						case 'label':
							return <div class="context-menu__label">{item.label}</div>
						case 'button-row':
							return (
								<div class="context-menu__button-row">
									<For each={item.buttons}>
										{(btn) => (
											<button
												class="context-menu__btn"
												classList={{
													'context-menu__btn--disabled': btn.disabled,
													'context-menu__btn--active': btn.active,
												}}
												onClick={() => {
													if (!btn.disabled) {
														btn.action()
														props.onSelect()
													}
												}}
											>
												<ContextMenuIcon icon={btn.icon} />
												{btn.label}
											</button>
										)}
									</For>
								</div>
							)
						case 'submenu': {
							let submenuRef: HTMLDivElement | undefined
							return (
								<div
									class="context-menu__submenu-wrap"
									classList={{ 'context-menu__submenu-wrap--disabled': item.disabled }}
									onMouseEnter={() => submenuRef && positionSubmenu(submenuRef)}
								>
									<button
										class="context-menu__item context-menu__submenu-trigger"
										classList={{ 'context-menu__item--disabled': item.disabled }}
										aria-haspopup="menu"
									>
										<ContextMenuIcon icon={item.icon} />
										<span>{item.label}</span>
										<ChevronRight class="context-menu__submenu-chevron" size={14} />
									</button>
									<div ref={submenuRef} class="context-menu__submenu" role="menu">
										<ContextMenuEntries items={item.items} onSelect={props.onSelect} />
									</div>
								</div>
							)
						}
					}
				}
				return (
					<button
						class="context-menu__item"
						classList={{ 'context-menu__item--disabled': item.disabled }}
						onClick={() => {
							if (!item.disabled) {
								item.action()
								props.onSelect()
							}
						}}
					>
						<ContextMenuIcon icon={item.icon} />
						{item.label}
					</button>
				)
			}}
		</For>
	)
}

export default function ContextMenu(props: ContextMenuProps) {
	let menuRef: HTMLDivElement | undefined

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			props.onClose()
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			props.onClose()
		}
	}

	function clampPosition() {
		if (!menuRef) return
		const rect = menuRef.getBoundingClientRect()
		const maxX = window.innerWidth - rect.width
		const maxY = window.innerHeight - rect.height
		if (props.x > maxX) {
			menuRef.style.left = `${maxX}px`
		}
		if (props.y > maxY) {
			menuRef.style.top = `${maxY}px`
		}
	}

	onMount(() => {
		clampPosition()
		setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside)
		}, 0)
		document.addEventListener('keydown', handleKeyDown)
	})

	onCleanup(() => {
		document.removeEventListener('mousedown', handleClickOutside)
		document.removeEventListener('keydown', handleKeyDown)
	})

	return (
		<div
			ref={menuRef}
			class="context-menu"
			style={{ left: `${props.x}px`, top: `${props.y}px` }}
		>
			<ContextMenuEntries items={props.items} onSelect={props.onClose} />
		</div>
	)
}
