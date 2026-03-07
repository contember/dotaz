import ChevronDown from 'lucide-solid/icons/chevron-down'
import { createSignal, For, onCleanup, onMount } from 'solid-js'
import './Select.css'

export interface SelectOption {
	value: string
	label: string
}

interface SelectProps {
	value: string
	onChange: (value: string) => void
	options: SelectOption[]
	class?: string
	disabled?: boolean
	placeholder?: string
	title?: string
}

export default function Select(props: SelectProps) {
	let triggerRef: HTMLButtonElement | undefined
	let listRef: HTMLDivElement | undefined
	const [open, setOpen] = createSignal(false)
	const [focusedIndex, setFocusedIndex] = createSignal(-1)
	const [above, setAbove] = createSignal(false)

	function selectedLabel() {
		const opt = props.options.find((o) => o.value === props.value)
		return opt?.label ?? props.placeholder ?? ''
	}

	function toggle() {
		if (props.disabled) return
		if (open()) {
			close()
		} else {
			openDropdown()
		}
	}

	function openDropdown() {
		const idx = props.options.findIndex((o) => o.value === props.value)
		setFocusedIndex(idx >= 0 ? idx : 0)
		setOpen(true)
		positionDropdown()
		requestAnimationFrame(() => {
			scrollToFocused()
		})
	}

	function close() {
		setOpen(false)
		triggerRef?.focus()
	}

	function select(value: string) {
		props.onChange(value)
		close()
	}

	function positionDropdown() {
		if (!triggerRef) return
		const rect = triggerRef.getBoundingClientRect()
		const spaceBelow = window.innerHeight - rect.bottom
		const dropdownHeight = Math.min(props.options.length * 28 + 8, 200)
		setAbove(spaceBelow < dropdownHeight && rect.top > spaceBelow)
	}

	function scrollToFocused() {
		if (!listRef) return
		const item = listRef.children[focusedIndex()] as HTMLElement | undefined
		item?.scrollIntoView({ block: 'nearest' })
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!open()) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				openDropdown()
			}
			return
		}

		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault()
				const next = Math.min(focusedIndex() + 1, props.options.length - 1)
				setFocusedIndex(next)
				scrollToFocused()
				break
			}
			case 'ArrowUp': {
				e.preventDefault()
				const prev = Math.max(focusedIndex() - 1, 0)
				setFocusedIndex(prev)
				scrollToFocused()
				break
			}
			case 'Enter':
			case ' ': {
				e.preventDefault()
				const opt = props.options[focusedIndex()]
				if (opt) select(opt.value)
				break
			}
			case 'Escape':
				e.preventDefault()
				close()
				break
			case 'Tab':
				close()
				break
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (
			triggerRef && !triggerRef.contains(e.target as Node)
			&& listRef && !listRef.contains(e.target as Node)
		) {
			setOpen(false)
		}
	}

	onMount(() => {
		document.addEventListener('mousedown', handleClickOutside)
	})

	onCleanup(() => {
		document.removeEventListener('mousedown', handleClickOutside)
	})

	return (
		<div class={`custom-select ${props.class ?? ''}`} classList={{ 'custom-select--disabled': props.disabled }}>
			<button
				ref={triggerRef}
				type="button"
				class="custom-select__trigger"
				disabled={props.disabled}
				title={props.title}
				onClick={toggle}
				onKeyDown={handleKeyDown}
			>
				<span class="custom-select__value">{selectedLabel()}</span>
				<ChevronDown size={12} class="custom-select__chevron" />
			</button>
			{open() && (
				<div
					ref={listRef}
					class="custom-select__dropdown"
					classList={{ 'custom-select__dropdown--above': above() }}
				>
					<For each={props.options}>
						{(opt, i) => (
							<button
								type="button"
								class="custom-select__option"
								classList={{
									'custom-select__option--selected': opt.value === props.value,
									'custom-select__option--focused': i() === focusedIndex(),
								}}
								onMouseEnter={() => setFocusedIndex(i())}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => select(opt.value)}
							>
								{opt.label}
							</button>
						)}
					</For>
				</div>
			)}
		</div>
	)
}
