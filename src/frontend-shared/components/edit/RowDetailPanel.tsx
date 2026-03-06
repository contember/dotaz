import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import ExternalLink from 'lucide-solid/icons/external-link'
import Pencil from 'lucide-solid/icons/pencil'
import X from 'lucide-solid/icons/x'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { buildCountQuery } from '../../../shared/sql'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { ForeignKeyInfo, ReferencingForeignKeyInfo } from '../../../shared/types/database'
import type { ColumnFilter, GridColumnDef } from '../../../shared/types/grid'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../lib/column-types'
import { isQuickValueModifier, quickValueModifierLabel } from '../../lib/keyboard'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import type { FkBreadcrumb } from '../../stores/grid'
import DateInput from '../common/DateInput'
import Resizer from '../layout/Resizer'
import './RowDetailPanel.css'

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
	const str = String(value)
	return str.length > 200 ? str.slice(0, 200) + '...' : str
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	if (typeof value === 'object') return JSON.stringify(value, null, 2)
	return String(value)
}

function parseValue(text: string, column: GridColumnDef): unknown {
	if (text === '') return column.nullable ? null : text
	if (isNumericType(column.dataType)) {
		const n = Number(text)
		return Number.isNaN(n) ? text : n
	}
	if (isBooleanType(column.dataType)) {
		const lower = text.toLowerCase()
		if (lower === 'true' || lower === '1' || lower === 't') return true
		if (lower === 'false' || lower === '0' || lower === 'f') return false
		return text
	}
	return text
}

function dateInputValue(value: unknown, dataType: DatabaseDataType): string {
	if (value === null || value === undefined || isSqlDefault(value)) return ''
	const str = String(value)
	if (dataType === DatabaseDataType.Date) {
		return str.substring(0, 10)
	}
	const d = new Date(str)
	if (Number.isNaN(d.getTime())) return str
	return d.toISOString().substring(0, 19)
}

export default function RowDetailPanel(props: RowDetailPanelProps) {
	const [editing, setEditing] = createSignal(false)
	const [localEdits, setLocalEdits] = createSignal<Record<string, unknown>>({})
	const [saving, setSaving] = createSignal(false)
	const [expandedField, setExpandedField] = createSignal<string | null>(null)

	// Reset edits when row data changes
	createEffect(on(() => props.row, () => {
		setLocalEdits({})
		setExpandedField(null)
	}))

	const fkLookup = () => buildFkLookup(props.foreignKeys)
	const pkColumns = () => new Set(props.columns.filter((c) => c.isPrimaryKey).map((c) => c.name))
	const canEdit = () => !props.readOnly && !!props.onSave && pkColumns().size > 0
	const hasEdits = () => Object.keys(localEdits()).length > 0

	// ── Referenced By ────────────────────────────────────────
	const referencingFks = createMemo(() =>
		connectionsStore.getReferencingForeignKeys(
			props.connectionId, props.schema, props.table, props.database,
		)
	)
	const [referencingCounts, setReferencingCounts] = createSignal<Record<string, number>>({})

	createEffect(on([referencingFks, () => props.row], () => {
		const fks = referencingFks()
		const row = props.row
		if (!fks.length || !row) {
			setReferencingCounts({})
			return
		}

		const dialect = connectionsStore.getDialect(props.connectionId)
		const counts: Record<string, number> = {}
		const promises = fks.map(async (fk) => {
			const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
				column: fk.referencingColumns[i],
				operator: 'eq' as const,
				value: row[refCol],
			}))

			if (filters.some((f) => f.value === null || f.value === undefined)) {
				counts[fk.constraintName] = 0
				return
			}

			try {
				const countQuery = buildCountQuery(fk.referencingSchema, fk.referencingTable, filters, dialect)
				const results = await rpc.query.execute({
					connectionId: props.connectionId,
					sql: countQuery.sql,
					queryId: `ref-count-${fk.constraintName}`,
					params: countQuery.params,
					database: props.database,
				})
				counts[fk.constraintName] = Number(results[0]?.rows[0]?.count ?? 0)
			} catch {
				counts[fk.constraintName] = -1
			}
		})

		Promise.all(promises).then(() => setReferencingCounts({ ...counts }))
	}))

	function handleReferencingClick(fk: ReferencingForeignKeyInfo) {
		const row = props.row
		if (!row || !props.onReferencingNavigate) return

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: 'eq' as const,
			value: String(row[refCol]),
		}))

		saveCurrentEdits()
		props.onReferencingNavigate(fk.referencingSchema, fk.referencingTable, filters)
	}

	// ── Field value helpers ──────────────────────────────────
	function getValue(column: string): unknown {
		const edits = localEdits()
		if (column in edits) return edits[column]
		return props.row ? props.row[column] : null
	}

	function isFieldNull(column: string): boolean {
		const v = getValue(column)
		return v === null || v === undefined
	}

	function isFieldDefault(column: string): boolean {
		return isSqlDefault(getValue(column))
	}

	function isChanged(column: string): boolean {
		if (column in localEdits()) return true
		return props.pendingChangedColumns?.has(column) ?? false
	}

	function setFieldValue(column: string, value: unknown) {
		setLocalEdits((prev) => ({ ...prev, [column]: value }))
	}

	function setNull(column: string) {
		setFieldValue(column, null)
	}

	function setDefault(column: string) {
		setFieldValue(column, SQL_DEFAULT)
	}

	function handleFieldKeyDown(e: KeyboardEvent, col: GridColumnDef) {
		const modifierActive = isQuickValueModifier(e)
		if (!modifierActive) return
		const key = e.key.toLowerCase()
		if (pkColumns().has(col.name)) return

		if (key === 'n' && col.nullable) {
			e.preventDefault()
			setNull(col.name)
		} else if (key === 't' && isBooleanType(col.dataType)) {
			e.preventDefault()
			setFieldValue(col.name, true)
		} else if (key === 'f' && isBooleanType(col.dataType)) {
			e.preventDefault()
			setFieldValue(col.name, false)
		} else if (key === 'd') {
			e.preventDefault()
			setDefault(col.name)
		}
	}

	// ── Save / Cancel ────────────────────────────────────────
	function saveCurrentEdits() {
		const edits = localEdits()
		if (Object.keys(edits).length > 0 && props.onSave) {
			props.onSave(edits)
			setLocalEdits({})
		}
	}

	async function handleSave() {
		const edits = localEdits()
		if (Object.keys(edits).length === 0) {
			setEditing(false)
			return
		}

		setSaving(true)
		try {
			await props.onSave?.(edits)
			setLocalEdits({})
			setEditing(false)
		} finally {
			setSaving(false)
		}
	}

	function handleCancelEdit() {
		setLocalEdits({})
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
		const fk = fkLookup().get(colName)
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

	// ── Render edit input ────────────────────────────────────
	function renderEditInput(col: GridColumnDef) {
		const isPk = pkColumns().has(col.name)
		const readOnly = isPk
		const value = getValue(col.name)
		const isNull = isFieldNull(col.name)
		const isDef = isFieldDefault(col.name)
		const specialPlaceholder = isDef ? 'DEFAULT' : isNull ? 'NULL' : ''

		if (isBooleanType(col.dataType)) {
			return (
				<div class="row-detail__checkbox-row" onKeyDown={(e) => handleFieldKeyDown(e, col)}>
					<input
						type="checkbox"
						checked={!!value && !isNull && !isDef}
						disabled={readOnly}
						onChange={(e) => setFieldValue(col.name, e.target.checked)}
					/>
					<span style={{ 'font-size': 'var(--font-size-sm)', color: 'var(--ink-secondary)' }}>
						{isDef ? 'DEFAULT' : isNull ? 'NULL' : value ? 'true' : 'false'}
					</span>
				</div>
			)
		}

		if (isDateType(col.dataType)) {
			return (
				<div class="row-detail__input-row">
					<DateInput
						class="row-detail__input"
						value={isNull || isDef ? '' : dateInputValue(value, col.dataType)}
						onChange={(v) => {
							if (v === '') {
								if (col.nullable) setFieldValue(col.name, null)
							} else {
								setFieldValue(col.name, v)
							}
						}}
						mode={col.dataType === DatabaseDataType.Date ? 'date' : 'datetime'}
						readOnly={readOnly}
						placeholder={specialPlaceholder}
						onKeyDown={(e) => handleFieldKeyDown(e, col)}
					/>
				</div>
			)
		}

		if (isTextType(col.dataType)) {
			return (
				<div class="row-detail__input-row">
					<Show when={(isNull || isDef) && readOnly}>
						<input
							class="row-detail__input row-detail__input--null"
							type="text"
							value={isDef ? 'DEFAULT' : 'NULL'}
							readOnly
						/>
					</Show>
					<Show when={!((isNull || isDef) && readOnly)}>
						<textarea
							class="row-detail__textarea"
							classList={{
								'row-detail__input--null': isNull,
								'row-detail__input--default': isDef,
							}}
							value={isNull || isDef ? '' : valueToString(value)}
							readOnly={readOnly}
							placeholder={specialPlaceholder}
							onKeyDown={(e) => handleFieldKeyDown(e, col)}
							onInput={(e) => setFieldValue(col.name, parseValue(e.target.value, col))}
						/>
					</Show>
				</div>
			)
		}

		return (
			<div class="row-detail__input-row">
				<input
					class="row-detail__input"
					classList={{
						'row-detail__input--null': isNull,
						'row-detail__input--default': isDef,
					}}
					type="text"
					inputMode={isNumericType(col.dataType) ? 'numeric' : undefined}
					value={isNull || isDef ? '' : valueToString(value)}
					readOnly={readOnly}
					placeholder={specialPlaceholder}
					onKeyDown={(e) => handleFieldKeyDown(e, col)}
					onInput={(e) => setFieldValue(col.name, parseValue(e.target.value, col))}
				/>
			</div>
		)
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
									const isFk = () => fkLookup().has(col.name) && value() !== null && value() !== undefined
									const isNull = () => value() === null || value() === undefined
									const isPk = () => pkColumns().has(col.name)

									return (
										<div class="row-detail-panel__view-field">
											<div class="row-detail-panel__view-field-label">
												<span class="row-detail-panel__view-field-name" title={col.name}>{col.name}</span>
												<Show when={isPk()}>
													<span class="row-detail__label-badge row-detail__label-badge--pk">PK</span>
												</Show>
												<Show when={fkLookup().has(col.name)}>
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
												title={isFk() ? `Go to ${fkLookup().get(col.name)!.table}` : undefined}
											>
												{formatDisplayValue(value())}
											</span>
										</div>
									)
								}}
							</For>
						</Show>

						{/* Edit mode */}
						<Show when={editing()}>
							<div class="row-detail-panel__edit-fields">
								<For each={props.columns}>
									{(col) => {
										const fk = () => {
											const lookup = fkLookup()
											return lookup.has(col.name) ? props.foreignKeys.find((f) => f.columns.includes(col.name)) : undefined
										}
										return (
											<div
												class="row-detail__field"
												classList={{ 'row-detail__field--changed': isChanged(col.name) }}
											>
												<div class="row-detail__label">
													<span class="row-detail__label-name">{col.name}</span>
													<span class="row-detail__label-type">{col.dataType}</span>
													<Show when={col.isPrimaryKey}>
														<span class="row-detail__label-badge row-detail__label-badge--pk">PK</span>
													</Show>
													<Show when={fk()}>
														<span class="row-detail__label-badge row-detail__label-badge--fk">FK</span>
													</Show>
													<Show when={!pkColumns().has(col.name)}>
														<div class="row-detail__label-actions">
															<Show when={col.nullable}>
																<button
																	class="row-detail__set-btn"
																	classList={{ 'row-detail__set-btn--active': isFieldNull(col.name) }}
																	onClick={() => setNull(col.name)}
																	title={`Set NULL (${quickValueModifierLabel()}+N)`}
																>
																	NULL
																</button>
															</Show>
															<button
																class="row-detail__set-btn"
																classList={{ 'row-detail__set-btn--active': isFieldDefault(col.name) }}
																onClick={() => setDefault(col.name)}
																title={`Set DEFAULT (${quickValueModifierLabel()}+D)`}
															>
																DEF
															</button>
														</div>
													</Show>
												</div>
												<Show when={fk()}>
													{(fkInfo) => (
														<span class="row-detail__fk-target">
															&#x2192; {fkInfo().referencedTable}.{fkInfo().referencedColumns.join(', ')}
														</span>
													)}
												</Show>
												{renderEditInput(col)}
											</div>
										)
									}}
								</For>
							</div>
						</Show>

						{/* Referenced By */}
						<Show when={referencingFks().length > 0}>
							<div class="row-detail__referenced-by">
								<div class="row-detail__referenced-by-header">Referenced By</div>
								<div class="row-detail__referenced-by-list">
									<For each={referencingFks()}>
										{(fk) => {
											const count = () => referencingCounts()[fk.constraintName]
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
													<Show when={count() !== undefined}>
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
							disabled={saving() || !hasEdits()}
						>
							{saving() ? 'Saving...' : 'Apply'}
						</button>
					</div>
				</Show>
			</div>
		</>
	)
}
