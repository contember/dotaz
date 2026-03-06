import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ExternalLink from 'lucide-solid/icons/external-link'
import FilterIcon from 'lucide-solid/icons/funnel'
import FilterXIcon from 'lucide-solid/icons/funnel-x'
import PanelRightOpen from 'lucide-solid/icons/panel-right-open'
import X from 'lucide-solid/icons/x'
import { createEffect, For, onCleanup, Show } from 'solid-js'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import type { FkPeekState } from '../../stores/grid'
import './FkPeekPopover.css'

interface FkPeekPopoverProps {
	peek: FkPeekState
	onClose: () => void
	onNavigate: (schema: string, table: string, column: string, value: unknown) => void
	onBack: () => void
	onOpenInPanel: () => void
	onOpenInTab: () => void
	onFilter?: (column: string, value: unknown, exclude: boolean) => void
}

function buildFkLookup(foreignKeys: ForeignKeyInfo[]): Map<string, { schema: string; table: string; column: string }> {
	const map = new Map<string, { schema: string; table: string; column: string }>()
	for (const fk of foreignKeys) {
		if (fk.columns.length === 1) {
			map.set(fk.columns[0], {
				schema: fk.referencedSchema,
				table: fk.referencedTable,
				column: fk.referencedColumns[0],
			})
		}
	}
	return map
}

function formatDisplayValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

/** Compute popover position, flipping if near edges. */
function computePosition(anchorRect: FkPeekState['anchorRect']): { top: string; left: string } {
	const popoverWidth = 380
	const popoverHeight = 400 // estimate
	const margin = 8

	let left = anchorRect.right + margin
	let top = anchorRect.top

	// Flip left if overflowing right
	if (left + popoverWidth > window.innerWidth - margin) {
		left = anchorRect.left - popoverWidth - margin
	}
	// Clamp left
	if (left < margin) left = margin

	// Flip up if overflowing bottom
	if (top + popoverHeight > window.innerHeight - margin) {
		top = window.innerHeight - popoverHeight - margin
	}
	if (top < margin) top = margin

	return { top: `${top}px`, left: `${left}px` }
}

export default function FkPeekPopover(props: FkPeekPopoverProps) {
	let popoverRef: HTMLDivElement | undefined

	// Close on Escape
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			props.onClose()
		}
	}

	// Close on click outside
	function handleClickOutside(e: MouseEvent) {
		if (popoverRef && !popoverRef.contains(e.target as Node)) {
			props.onClose()
		}
	}

	createEffect(() => {
		document.addEventListener('keydown', handleKeyDown, true)
		// Delay adding click listener to avoid immediate close from the FK link click
		const timer = setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside)
		}, 0)
		onCleanup(() => {
			document.removeEventListener('keydown', handleKeyDown, true)
			document.removeEventListener('mousedown', handleClickOutside)
			clearTimeout(timer)
		})
	})

	const fkLookup = () => buildFkLookup(props.peek.foreignKeys)
	const position = () => computePosition(props.peek.anchorRect)
	const hasBreadcrumbs = () => props.peek.breadcrumbs.length > 1
	const currentBreadcrumb = () => props.peek.breadcrumbs[props.peek.breadcrumbs.length - 1]

	const filterBadge = () => {
		const bc = currentBreadcrumb()
		if (!bc) return ''
		return `${bc.column} = ${bc.value}`
	}

	function handleFkValueClick(colName: string, value: unknown) {
		const fk = fkLookup().get(colName)
		if (!fk || value === null || value === undefined) return
		props.onNavigate(fk.schema, fk.table, fk.column, value)
	}

	return (
		<div
			ref={popoverRef}
			class="fk-peek"
			style={position()}
		>
			{/* Breadcrumbs (only show when stacked) */}
			<Show when={hasBreadcrumbs()}>
				<div class="fk-peek__breadcrumbs">
					<button
						class="fk-peek__breadcrumb-back"
						onClick={props.onBack}
						title="Go back"
					>
						<ChevronLeft size={12} />
					</button>
					<For each={props.peek.breadcrumbs.slice(0, -1)}>
						{(bc) => (
							<>
								<span class="fk-peek__breadcrumb-item">{bc.table}</span>
								<span class="fk-peek__breadcrumb-sep">&#8250;</span>
							</>
						)}
					</For>
					<span class="fk-peek__breadcrumb-current">{props.peek.table}</span>
				</div>
			</Show>

			{/* Header */}
			<div class="fk-peek__header">
				<div class="fk-peek__header-info">
					<span class="fk-peek__table-name">{props.peek.table}</span>
					<span class="fk-peek__filter-badge">{filterBadge()}</span>
				</div>
				<button class="fk-peek__close-btn" onClick={props.onClose} title="Close">
					<X size={14} />
				</button>
			</div>

			{/* Body — vertical field list */}
			<div class="fk-peek__body">
				<Show when={props.peek.loading}>
					<div class="fk-peek__loading">Loading...</div>
				</Show>
				<Show when={!props.peek.loading && props.peek.rows.length === 0}>
					<div class="fk-peek__empty">No matching row found</div>
				</Show>
				<Show when={!props.peek.loading && props.peek.rows.length > 0}>
					<For each={props.peek.columns}>
						{(col) => {
							const value = () => props.peek.rows[0]?.[col.name]
							const isFk = () => fkLookup().has(col.name) && value() !== null && value() !== undefined
							const isNull = () => value() === null || value() === undefined
							return (
								<div class="fk-peek__field">
									<span class="fk-peek__field-name" title={col.name}>{col.name}</span>
									<span
										class="fk-peek__field-value"
										classList={{
											'fk-peek__field-value--null': isNull(),
											'fk-peek__field-value--fk': isFk(),
										}}
										onClick={isFk() ? () => handleFkValueClick(col.name, value()) : undefined}
										title={isFk() ? `Go to ${fkLookup().get(col.name)!.table}` : formatDisplayValue(value())}
									>
										{formatDisplayValue(value())}
									</span>
									<Show when={props.onFilter}>
										<span class="fk-peek__field-actions">
											<button
												class="fk-peek__filter-btn"
												title={`Filter: ${col.name} = ${formatDisplayValue(value())}`}
												onClick={() => props.onFilter!(col.name, value(), false)}
											>
												<FilterIcon size={10} />
											</button>
											<button
												class="fk-peek__filter-btn"
												title={`Filter: ${col.name} != ${formatDisplayValue(value())}`}
												onClick={() => props.onFilter!(col.name, value(), true)}
											>
												<FilterXIcon size={10} />
											</button>
										</span>
									</Show>
								</div>
							)
						}}
					</For>
				</Show>
			</div>

			{/* Action buttons */}
			<div class="fk-peek__actions">
				<button class="fk-peek__action-btn" onClick={props.onOpenInPanel}>
					<PanelRightOpen size={12} /> Open in Panel
				</button>
				<button class="fk-peek__action-btn" onClick={props.onOpenInTab}>
					<ExternalLink size={12} /> Open in Tab
				</button>
			</div>
		</div>
	)
}
