import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Save from 'lucide-solid/icons/save'
import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js'
import { buildCountQuery, buildSelectQuery, generateUpdate } from '../../../shared/sql'
import type { ForeignKeyInfo, ReferencingForeignKeyInfo } from '../../../shared/types/database'
import type { ColumnFilter } from '../../../shared/types/grid'
import type { GridColumnDef } from '../../../shared/types/grid'
import type { UpdateChange } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import RowDetailEditFields from './RowDetailEditFields'
import './RowDetailTab.css'
import './RowDetailPanel.css'

interface RowDetailTabProps {
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
	primaryKeys: Record<string, unknown>
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

export default function RowDetailTab(props: RowDetailTabProps) {
	const [row, setRow] = createSignal<Record<string, unknown> | null>(null)
	const [columns, setColumns] = createSignal<GridColumnDef[]>([])
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([])
	const [localEdits, setLocalEdits] = createSignal<Record<string, unknown>>({})
	const [loading, setLoading] = createSignal(true)
	const [notFound, setNotFound] = createSignal(false)
	const [saveError, setSaveError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const dialect = () => connectionsStore.getDialect(props.connectionId)

	const pkColumns = createMemo(() => new Set(columns().filter((c) => c.isPrimaryKey).map((c) => c.name)))
	const fkLookup = createMemo(() => buildFkLookup(foreignKeys()))

	const hasEdits = createMemo(() => Object.keys(localEdits()).length > 0)

	// Track dirty state
	createEffect(() => {
		tabsStore.setTabDirty(props.tabId, hasEdits())
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
	const [referencingCounts, setReferencingCounts] = createSignal<Record<string, number | null>>({})
	const [countingFks, setCountingFks] = createSignal<Set<string>>(new Set())

	createEffect(on([referencingFks, row], () => {
		setReferencingCounts({})
		setCountingFks(new Set<string>())
	}))

	async function fetchReferencingCount(fk: ReferencingForeignKeyInfo) {
		const currentRow = row()
		if (!currentRow) return

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: 'eq' as const,
			value: currentRow[refCol],
		}))

		if (filters.some((f) => f.value === null || f.value === undefined)) {
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: 0 }))
			return
		}

		setCountingFks((prev) => new Set([...prev, fk.constraintName]))
		try {
			const countQuery = buildCountQuery(fk.referencingSchema, fk.referencingTable, filters, dialect())
			const results = await rpc.query.execute({
				connectionId: props.connectionId,
				sql: countQuery.sql,
				queryId: `ref-count-${fk.constraintName}`,
				params: countQuery.params,
				database: props.database,
			})
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: Number(results[0]?.rows[0]?.count ?? 0) }))
		} catch {
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: -1 }))
		} finally {
			setCountingFks((prev) => {
				const next = new Set(prev)
				next.delete(fk.constraintName)
				return next
			})
		}
	}

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

			const pkFilters: ColumnFilter[] = Object.entries(props.primaryKeys).map(([col, val]) => ({
				column: col,
				operator: 'eq' as const,
				value: val,
			}))

			const query = buildSelectQuery(props.schema, props.table, 1, 1, undefined, pkFilters, dialect())
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

	function isChanged(column: string): boolean {
		return column in localEdits()
	}

	function setFieldValue(column: string, value: unknown) {
		setLocalEdits((prev) => ({ ...prev, [column]: value }))
	}

	// ── Save ─────────────────────────────────────────────────

	async function handleSave() {
		const edits = localEdits()
		if (Object.keys(edits).length === 0) return

		setSaving(true)
		setSaveError(null)

		try {
			const change: UpdateChange = {
				type: 'update',
				schema: props.schema,
				table: props.table,
				primaryKeys: props.primaryKeys,
				values: edits,
			}
			const stmt = generateUpdate(change, dialect())

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
		return Object.entries(props.primaryKeys)
			.map(([col, val]) => `${col}=${val === null ? 'NULL' : val}`)
			.join(', ')
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
						<RowDetailEditFields
							columns={columns()}
							fkLookup={fkLookup()}
							pkColumns={pkColumns()}
							getValue={getValue}
							isChanged={isChanged}
							setFieldValue={setFieldValue}
							connectionId={props.connectionId}
							database={props.database}
						/>
					</div>

					<Show when={referencingFks().length > 0}>
						<div class="row-detail__referenced-by">
							<div class="row-detail__referenced-by-header">Referenced By</div>
							<div class="row-detail__referenced-by-list">
								<For each={referencingFks()}>
									{(fk) => {
										const count = () => referencingCounts()[fk.constraintName]
										const counting = () => countingFks().has(fk.constraintName)
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
												<Show
													when={count() !== undefined && count() !== null}
													fallback={
														<span
															class="row-detail__referenced-by-count row-detail__referenced-by-count--unknown"
															onClick={(e) => {
																e.stopPropagation()
																fetchReferencingCount(fk)
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
				</div>
			</Show>
		</div>
	)
}
