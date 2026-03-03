import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Save from 'lucide-solid/icons/save'
import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js'
import { buildCountQuery, buildSelectQuery, generateUpdate } from '../../../shared/sql'
import type { ColumnInfo, ForeignKeyInfo, ReferencingForeignKeyInfo } from '../../../shared/types/database'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { ColumnFilter } from '../../../shared/types/grid'
import type { UpdateChange } from '../../../shared/types/rpc'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../lib/column-types'
import { isQuickValueModifier, quickValueModifierLabel } from '../../lib/keyboard'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import './RowDetailTab.css'
import './RowDetailDialog.css'

interface RowDetailTabProps {
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
	primaryKeys: Record<string, unknown>
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	if (typeof value === 'object') return JSON.stringify(value, null, 2)
	return String(value)
}

function parseValue(text: string, column: ColumnInfo): unknown {
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

export default function RowDetailTab(props: RowDetailTabProps) {
	const [row, setRow] = createSignal<Record<string, unknown> | null>(null)
	const [columns, setColumns] = createSignal<ColumnInfo[]>([])
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([])
	const [localEdits, setLocalEdits] = createSignal<Record<string, unknown>>({})
	const [loading, setLoading] = createSignal(true)
	const [notFound, setNotFound] = createSignal(false)
	const [saveError, setSaveError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const dialect = () => connectionsStore.getDialect(props.connectionId)

	const pkColumns = createMemo(() => new Set(columns().filter((c) => c.isPrimaryKey).map((c) => c.name)))

	const hasEdits = createMemo(() => Object.keys(localEdits()).length > 0)

	// Track dirty state
	createEffect(() => {
		tabsStore.setTabDirty(props.tabId, hasEdits())
	})

	// Build FK lookup: column name -> ForeignKeyInfo
	const fkMap = createMemo(() => {
		const map = new Map<string, ForeignKeyInfo>()
		for (const fk of foreignKeys()) {
			for (const col of fk.columns) {
				map.set(col, fk)
			}
		}
		return map
	})

	// ── Reverse FK (Referenced By) ───────────────────────────
	const referencingFks = createMemo(() =>
		connectionsStore.getReferencingForeignKeys(
			props.connectionId,
			props.schema,
			props.table,
			props.database,
		)
	)
	const [referencingCounts, setReferencingCounts] = createSignal<Record<string, number>>({})

	// Fetch counts for each referencing FK when row changes
	createEffect(on([referencingFks, row], () => {
		const fks = referencingFks()
		const currentRow = row()
		if (!fks.length || !currentRow) {
			setReferencingCounts({})
			return
		}

		const d = dialect()
		const counts: Record<string, number> = {}
		const promises = fks.map(async (fk) => {
			const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
				column: fk.referencingColumns[i],
				operator: 'eq' as const,
				value: currentRow[refCol],
			}))

			if (filters.some((f) => f.value === null || f.value === undefined)) {
				counts[fk.constraintName] = 0
				return
			}

			try {
				const countQuery = buildCountQuery(fk.referencingSchema, fk.referencingTable, filters, d)
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
		const currentRow = row()
		if (!currentRow) return

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: 'eq' as const,
			value: String(currentRow[refCol]),
		}))

		const newTabId = tabsStore.openTab({
			type: 'data-grid',
			title: fk.referencingTable,
			connectionId: props.connectionId,
			schema: fk.referencingSchema,
			table: fk.referencingTable,
			database: props.database,
		})

		// Apply FK filters to the new grid tab after it loads
		gridStore.loadTableData(
			newTabId,
			props.connectionId,
			fk.referencingSchema,
			fk.referencingTable,
			props.database,
		).then(() => {
			for (const f of filters) {
				gridStore.setFilter(newTabId, f)
			}
		})
	}

	// ── Data fetching ────────────────────────────────────────

	async function fetchRow() {
		setLoading(true)
		setNotFound(false)
		setSaveError(null)

		try {
			const cols = connectionsStore.getColumns(props.connectionId, props.schema, props.table, props.database)
			setColumns(cols)

			const fks = connectionsStore.getForeignKeys(props.connectionId, props.schema, props.table, props.database)
			setForeignKeys(fks)

			const d = dialect()
			const pkFilters: ColumnFilter[] = Object.entries(props.primaryKeys).map(([col, val]) => ({
				column: col,
				operator: 'eq' as const,
				value: val,
			}))

			const query = buildSelectQuery(props.schema, props.table, 1, 1, undefined, pkFilters, d)
			const results = await rpc.query.execute({
				connectionId: props.connectionId,
				sql: query.sql,
				queryId: `row-detail-tab-${props.tabId}`,
				params: query.params,
				database: props.database,
			})

			if (results[0]?.rows.length > 0) {
				setRow(results[0].rows[0])
			} else {
				setNotFound(true)
			}
		} catch (err) {
			setSaveError(String(err))
		} finally {
			setLoading(false)
		}
	}

	onMount(() => {
		fetchRow()
	})

	// ── Field helpers ────────────────────────────────────────

	function getValue(column: string): unknown {
		const edits = localEdits()
		if (column in edits) return edits[column]
		const r = row()
		return r ? r[column] : null
	}

	function isFieldNull(column: string): boolean {
		const v = getValue(column)
		return v === null || v === undefined
	}

	function isFieldDefault(column: string): boolean {
		return isSqlDefault(getValue(column))
	}

	function isChanged(column: string): boolean {
		return column in localEdits()
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

	function handleFieldKeyDown(e: KeyboardEvent, col: ColumnInfo) {
		const modifierActive = isQuickValueModifier(e)
		if (!modifierActive) return
		const key = e.key.toLowerCase()
		const isPk = pkColumns().has(col.name)
		if (isPk) return

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

	// ── Save ─────────────────────────────────────────────────

	async function handleSave() {
		const edits = localEdits()
		if (Object.keys(edits).length === 0) return

		setSaving(true)
		setSaveError(null)

		try {
			const d = dialect()
			const change: UpdateChange = {
				type: 'update',
				schema: props.schema,
				table: props.table,
				primaryKeys: props.primaryKeys,
				values: edits,
			}
			const stmt = generateUpdate(change, d)

			await rpc.query.execute({
				connectionId: props.connectionId,
				sql: '',
				queryId: `row-detail-save-${props.tabId}`,
				database: props.database,
				statements: [{ sql: stmt.sql, params: stmt.params }],
			})

			setLocalEdits({})
			await fetchRow()
		} catch (err) {
			setSaveError(String(err))
		} finally {
			setSaving(false)
		}
	}

	// ── Header ───────────────────────────────────────────────

	function pkDisplay(): string {
		const parts: string[] = []
		for (const [col, val] of Object.entries(props.primaryKeys)) {
			parts.push(`${col}=${val === null ? 'NULL' : val}`)
		}
		return parts.join(', ')
	}

	// ── Render field input by type ───────────────────────────

	function renderInput(col: ColumnInfo) {
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
			const inputType = col.dataType === DatabaseDataType.Date ? 'date' : 'datetime-local'
			return (
				<div class="row-detail__input-row">
					<input
						class="row-detail__input"
						classList={{
							'row-detail__input--null': isNull,
							'row-detail__input--default': isDef,
						}}
						type={inputType}
						value={isNull || isDef ? '' : dateInputValue(value, col.dataType)}
						readOnly={readOnly}
						placeholder={specialPlaceholder}
						onKeyDown={(e) => handleFieldKeyDown(e, col)}
						onInput={(e) => {
							const v = e.target.value
							if (v === '') {
								if (col.nullable) setFieldValue(col.name, null)
							} else {
								setFieldValue(col.name, v)
							}
						}}
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
							onInput={(e) => {
								setFieldValue(col.name, parseValue(e.target.value, col))
							}}
						/>
					</Show>
				</div>
			)
		}

		// Numeric and generic fallback
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
					onInput={(e) => {
						setFieldValue(col.name, parseValue(e.target.value, col))
					}}
				/>
			</div>
		)
	}

	return (
		<div class="row-detail-tab">
			<div class="row-detail-tab__header">
				<div>
					<span class="row-detail-tab__header-title">{props.table}</span>
					<span class="row-detail-tab__header-pk">{pkDisplay()}</span>
				</div>
				<div class="row-detail-tab__header-actions">
					<button
						class="btn btn--secondary btn--sm"
						onClick={() => {
							setLocalEdits({})
							fetchRow()
						}}
						disabled={loading()}
						title="Reload row"
					>
						<RotateCcw size={14} /> Reload
					</button>
					<button
						class="btn btn--primary btn--sm"
						onClick={handleSave}
						disabled={!hasEdits() || saving()}
						title="Save changes"
					>
						<Save size={14} /> Save
					</button>
				</div>
			</div>

			<Show when={saveError()}>
				<div class="row-detail-tab__save-error">{saveError()}</div>
			</Show>

			<Show when={loading()}>
				<div class="row-detail-tab__loading">Loading...</div>
			</Show>

			<Show when={notFound() && !loading()}>
				<div class="row-detail-tab__error">Row not found. It may have been deleted.</div>
			</Show>

			<Show when={row() && !loading()}>
				<div class="row-detail-tab__body">
					<div class="row-detail__fields" style={{ 'max-height': 'none' }}>
						<For each={columns()}>
							{(col) => {
								const fk = () => fkMap().get(col.name)
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
										{renderInput(col)}
									</div>
								)
							}}
						</For>
					</div>

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
				</div>
			</Show>
		</div>
	)
}
