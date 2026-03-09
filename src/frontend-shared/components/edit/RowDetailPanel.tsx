import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import ExternalLink from 'lucide-solid/icons/external-link'
import Pencil from 'lucide-solid/icons/pencil'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, For, on, Show } from 'solid-js'
import type { ForeignKeyInfo } from '@dotaz/shared/types/database'
import type { ColumnFilter, GridColumnDef } from '@dotaz/shared/types/grid'
import { formatDisplayValue } from '../../lib/value-format'
import type { FkBreadcrumb } from '../../stores/grid'
import Resizer from '../layout/Resizer'
import RowDetailEditFields from './RowDetailEditFields'
import './RowDetailPanel.css'
import { useRowDetail } from './useRowDetail'

interface RowDetailPanelProps {
	connectionId: string
	schema: string
	table: string
	database?: string
	columns: GridColumnDef[]
	row: Record<string, unknown> | null
	foreignKeys: ForeignKeyInfo[]
	width: number
	loading?: boolean
	readOnly?: boolean

	// Navigation
	rowLabel?: string
	canGoPrev?: boolean
	canGoNext?: boolean
	onPrev?: () => void
	onNext?: () => void

	// Breadcrumbs (FK chain)
	breadcrumbs?: FkBreadcrumb[]
	onBack?: () => void

	// Edit
	onSave?: (changes: Record<string, unknown>) => void | Promise<void>
	pendingChangedColumns?: Set<string>

	// FK value navigation
	onFkNavigate?: (schema: string, table: string, column: string, value: unknown) => void

	// Referenced By navigation
	onReferencingNavigate?: (schema: string, table: string, filters: ColumnFilter[]) => void

	// Open in Tab
	onOpenInTab?: () => void

	// Panel
	onClose: () => void
	onResize: (delta: number) => void

	subtitle?: string
}

export default function RowDetailPanel(props: RowDetailPanelProps) {
	const detail = useRowDetail({
		get connectionId() {
			return props.connectionId
		},
		get schema() {
			return props.schema
		},
		get table() {
			return props.table
		},
		get database() {
			return props.database
		},
		get columns() {
			return props.columns
		},
		get row() {
			return props.row
		},
		get foreignKeys() {
			return props.foreignKeys
		},
		onSave: props.onSave,
	})

	const [editing, setEditing] = createSignal(false)
	const [saving, setSaving] = createSignal(false)
	const [expandedField, setExpandedField] = createSignal<string | null>(null)

	// Reset expanded field when row changes
	createEffect(on(() => props.row, () => {
		setExpandedField(null)
	}))

	const canEdit = () => !props.readOnly && !!props.onSave && detail.pkColumns().size > 0

	function isChanged(column: string): boolean {
		if (detail.isFieldChanged(column)) return true
		return props.pendingChangedColumns?.has(column) ?? false
	}

	// ── Referenced By navigation ─────────────────────────────
	function handleReferencingClick(fk: Parameters<typeof detail.buildReferencingFilters>[0]) {
		if (!props.onReferencingNavigate) return
		const filters = detail.buildReferencingFilters(fk)
		if (!filters) return

		const stringFilters: ColumnFilter[] = filters.map((f) => ({
			...f,
			value: String(f.value),
		}))

		saveCurrentEdits()
		props.onReferencingNavigate(fk.referencingSchema, fk.referencingTable, stringFilters)
	}

	// ── Save / Cancel ────────────────────────────────────────
	function saveCurrentEdits() {
		const edits = detail.localEdits()
		if (Object.keys(edits).length > 0 && props.onSave) {
			props.onSave(edits)
			detail.resetEdits()
		}
	}

	async function handleSave() {
		const edits = detail.localEdits()
		if (Object.keys(edits).length === 0) {
			setEditing(false)
			return
		}

		setSaving(true)
		try {
			await props.onSave?.(edits)
			detail.resetEdits()
			setEditing(false)
		} finally {
			setSaving(false)
		}
	}

	function handleCancelEdit() {
		detail.resetEdits()
		setEditing(false)
	}

	// ── Navigation ───────────────────────────────────────────
	function handlePrev() {
		saveCurrentEdits()
		props.onPrev?.()
	}

	function handleNext() {
		saveCurrentEdits()
		props.onNext?.()
	}

	function handleClose() {
		saveCurrentEdits()
		props.onClose()
	}

	// ── FK value click ───────────────────────────────────────
	function handleFkValueClick(colName: string, value: unknown) {
		const fk = detail.fkLookup().get(colName)
		if (!fk || value === null || value === undefined || !props.onFkNavigate) return
		saveCurrentEdits()
		props.onFkNavigate(fk.schema, fk.table, fk.column, value)
	}

	// ── Keyboard ─────────────────────────────────────────────
	function handlePanelKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp' && (e.altKey || e.ctrlKey)) {
			e.preventDefault()
			handlePrev()
		} else if (e.key === 'ArrowDown' && (e.altKey || e.ctrlKey)) {
			e.preventDefault()
			handleNext()
		}
	}

	// ── Render ───────────────────────────────────────────────

	return (
		<>
			<Resizer onResize={(delta) => props.onResize(-delta)} />
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
			<div class="row-detail-panel" style={{ width: `${props.width}px` }} onKeyDown={handlePanelKeyDown}>
				{/* Breadcrumbs */}
				<Show when={props.breadcrumbs && props.breadcrumbs.length > 1}>
					<div class="row-detail-panel__breadcrumbs">
						<button
							class="row-detail-panel__breadcrumb-back"
							onClick={props.onBack}
							title="Go back"
						>
							<ChevronLeft size={12} />
						</button>
						<For each={props.breadcrumbs!.slice(0, -1)}>
							{(bc) => (
								<>
									<span class="row-detail-panel__breadcrumb-item">{bc.table}</span>
									<span class="row-detail-panel__breadcrumb-sep">&#8250;</span>
								</>
							)}
						</For>
						<span class="row-detail-panel__breadcrumb-current">{props.table}</span>
					</div>
				</Show>

				{/* Header */}
				<div class="row-detail-panel__header">
					<div class="row-detail-panel__header-info">
						<span class="row-detail-panel__table-name">{props.table}</span>
						<Show when={props.subtitle}>
							<span class="row-detail-panel__subtitle">{props.subtitle}</span>
						</Show>
					</div>
					<button class="row-detail-panel__close-btn" onClick={handleClose} title="Close panel">
						<X size={14} />
					</button>
				</div>

				{/* Navigation bar */}
				<div class="row-detail-panel__nav">
					<span class="row-detail-panel__nav-info">{props.rowLabel}</span>
					<div class="row-detail-panel__nav-buttons">
						<Show when={props.onPrev}>
							<button
								class="row-detail-panel__nav-btn"
								disabled={!props.canGoPrev}
								onClick={handlePrev}
								title="Previous row (Ctrl+Up)"
							>
								<ChevronUp size={14} />
							</button>
						</Show>
						<Show when={props.onNext}>
							<button
								class="row-detail-panel__nav-btn"
								disabled={!props.canGoNext}
								onClick={handleNext}
								title="Next row (Ctrl+Down)"
							>
								<ChevronDown size={14} />
							</button>
						</Show>
						<Show when={canEdit()}>
							<button
								class="row-detail-panel__nav-btn"
								classList={{ 'row-detail-panel__nav-btn--active': editing() }}
								onClick={() => {
									if (editing()) {
										handleSave()
									} else {
										setEditing(true)
									}
								}}
								title={editing() ? 'Switch to view mode' : 'Edit row'}
							>
								<Pencil size={14} />
							</button>
						</Show>
						<Show when={props.onOpenInTab}>
							<button
								class="row-detail-panel__nav-btn"
								onClick={props.onOpenInTab}
								title="Open in separate tab"
							>
								<ExternalLink size={14} />
							</button>
						</Show>
					</div>
				</div>

				{/* Body */}
				<div class="row-detail-panel__body">
					<Show when={props.loading}>
						<div class="row-detail-panel__loading">Loading...</div>
					</Show>

					<Show when={!props.loading && !props.row}>
						<div class="row-detail-panel__empty">No data</div>
					</Show>

					<Show when={!props.loading && props.row}>
						{/* View mode */}
						<Show when={!editing()}>
							<For each={props.columns}>
								{(col) => {
									const value = () => props.row?.[col.name]
									const isFk = () => detail.fkLookup().has(col.name) && value() !== null && value() !== undefined
									const isNull = () => value() === null || value() === undefined
									const isPk = () => detail.pkColumns().has(col.name)

									return (
										<div class="row-detail-panel__view-field">
											<div class="row-detail-panel__view-field-label">
												<span class="row-detail-panel__view-field-name" title={col.name}>{col.name}</span>
												<Show when={isPk()}>
													<span class="row-detail__label-badge row-detail__label-badge--pk">PK</span>
												</Show>
												<Show when={detail.fkLookup().has(col.name)}>
													<span class="row-detail__label-badge row-detail__label-badge--fk">FK</span>
												</Show>
											</div>
											<span
												class="row-detail-panel__view-field-value"
												classList={{
													'row-detail-panel__view-field-value--null': isNull(),
													'row-detail-panel__view-field-value--fk': isFk(),
													'row-detail-panel__view-field-value--expanded': expandedField() === col.name,
												}}
												onClick={isFk()
													? () => handleFkValueClick(col.name, value())
													: !isNull()
													? () => setExpandedField((prev) => prev === col.name ? null : col.name)
													: undefined}
												title={isFk() ? `Go to ${detail.fkLookup().get(col.name)!.table}` : undefined}
											>
												{formatDisplayValue(value(), 200)}
											</span>
										</div>
									)
								}}
							</For>
						</Show>

						{/* Edit mode */}
						<Show when={editing()}>
							<div class="row-detail-panel__edit-fields">
								<RowDetailEditFields
									columns={props.columns}
									fkLookup={detail.fkLookup()}
									pkColumns={detail.pkColumns()}
									getValue={detail.getValue}
									isChanged={isChanged}
									setFieldValue={detail.setFieldValue}
									connectionId={props.connectionId}
									database={props.database}
								/>
							</div>
						</Show>

						{/* Referenced By */}
						<Show when={detail.referencingFks().length > 0}>
							<div class="row-detail__referenced-by">
								<div class="row-detail__referenced-by-header">Referenced By</div>
								<div class="row-detail__referenced-by-list">
									<For each={detail.referencingFks()}>
										{(fk) => {
											const count = () => detail.referencingCounts()[fk.constraintName]
											const counting = () => detail.countingFks().has(fk.constraintName)
											return (
												<button
													class="row-detail__referenced-by-item"
													onClick={() => handleReferencingClick(fk)}
													disabled={!props.onReferencingNavigate}
													title={`Show referencing rows in ${fk.referencingTable}`}
												>
													<span class="row-detail__referenced-by-table">
														{fk.referencingSchema !== props.schema
															? `${fk.referencingSchema}.${fk.referencingTable}`
															: fk.referencingTable}
													</span>
													<span class="row-detail__referenced-by-cols">
														({fk.referencingColumns.join(', ')})
													</span>
													<Show
														when={count() !== undefined && count() !== null}
														fallback={
															<span
																class="row-detail__referenced-by-count row-detail__referenced-by-count--unknown"
																onClick={(e) => {
																	e.stopPropagation()
																	detail.fetchReferencingCount(fk)
																}}
																title="Click to count"
															>
																{counting() ? '…' : '?'}
															</span>
														}
													>
														<span class="row-detail__referenced-by-count">
															{count() === -1 ? '?' : count()}
														</span>
													</Show>
												</button>
											)
										}}
									</For>
								</div>
							</div>
						</Show>
					</Show>
				</div>

				{/* Actions (edit mode only) */}
				<Show when={editing()}>
					<div class="row-detail-panel__actions">
						<button
							class="btn btn--secondary"
							onClick={handleCancelEdit}
							disabled={saving()}
						>
							Discard
						</button>
						<button
							class="btn btn--primary"
							onClick={handleSave}
							disabled={saving() || !detail.hasEdits()}
						>
							{saving() ? 'Saving...' : 'Apply'}
						</button>
					</div>
				</Show>
			</div>
		</>
	)
}
