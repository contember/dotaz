import { buildSelectQuery, generateUpdate } from '@dotaz/shared/sql'
import type { ForeignKeyInfo } from '@dotaz/shared/types/database'
import type { ColumnFilter, GridColumnDef } from '@dotaz/shared/types/grid'
import type { UpdateChange } from '@dotaz/shared/types/rpc'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Save from 'lucide-solid/icons/save'
import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import RowDetailEditFields from './RowDetailEditFields'
import './RowDetailTab.css'
import './RowDetailPanel.css'
import { useRowDetail } from './useRowDetail'

interface RowDetailTabProps {
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
	primaryKeys: Record<string, unknown>
}

export default function RowDetailTab(props: RowDetailTabProps) {
	const [row, setRow] = createSignal<Record<string, unknown> | null>(null)
	const [columns, setColumns] = createSignal<GridColumnDef[]>([])
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([])
	const [loading, setLoading] = createSignal(true)
	const [notFound, setNotFound] = createSignal(false)
	const [saveError, setSaveError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const dialect = () => connectionsStore.getDialect(props.connectionId)

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
			return columns()
		},
		get row() {
			return row()
		},
		get foreignKeys() {
			return foreignKeys()
		},
	})

	// Track dirty state
	createEffect(() => {
		tabsStore.setTabDirty(props.tabId, detail.hasEdits())
	})

	// ── Referenced By navigation ─────────────────────────────
	function handleReferencingClick(fk: Parameters<typeof detail.buildReferencingFilters>[0]) {
		const filters = detail.buildReferencingFilters(fk)
		if (!filters) return

		const stringFilters: ColumnFilter[] = filters.map((f) => ({
			...f,
			value: String(f.value),
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
			for (const f of stringFilters) {
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

	// ── Save ─────────────────────────────────────────────────

	async function handleSave() {
		const edits = detail.localEdits()
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

			detail.resetEdits()
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
							detail.resetEdits()
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
						disabled={!detail.hasEdits() || saving()}
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
							fkLookup={detail.fkLookup()}
							pkColumns={detail.pkColumns()}
							getValue={detail.getValue}
							isChanged={detail.isFieldChanged}
							setFieldValue={detail.setFieldValue}
							connectionId={props.connectionId}
							database={props.database}
						/>
					</div>

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
				</div>
			</Show>
		</div>
	)
}
