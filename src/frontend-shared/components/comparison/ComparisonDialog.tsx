import type { ComparisonColumnMapping, ComparisonSource } from '@dotaz/shared/types/comparison'
import type { ColumnInfo, SchemaData } from '@dotaz/shared/types/database'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import Dialog from '../common/Dialog'
import Icon from '../common/Icon'
import Select from '../common/Select'
import './ComparisonDialog.css'

interface ComparisonDialogProps {
	open: boolean
	onClose: () => void
	onCompare: (
		left: ComparisonSource,
		right: ComparisonSource,
		keyColumns: ComparisonColumnMapping[],
		columnMappings: ComparisonColumnMapping[],
	) => void
	/** Pre-fill left source from current context */
	initialLeft?: { connectionId: string; schema: string; table: string; database?: string }
}

type SourceType = 'table' | 'query'

interface SourceState {
	connectionId: string
	database: string
	type: SourceType
	schema: string
	table: string
	sql: string
}

function createInitialSource(initial?: { connectionId: string; schema: string; table: string; database?: string }): SourceState {
	return {
		connectionId: initial?.connectionId ?? '',
		database: initial?.database ?? '',
		type: 'table',
		schema: initial?.schema ?? '',
		table: initial?.table ?? '',
		sql: '',
	}
}

export default function ComparisonDialog(props: ComparisonDialogProps) {
	const [left, setLeft] = createSignal<SourceState>(createInitialSource())
	const [right, setRight] = createSignal<SourceState>(createInitialSource())
	const [leftSchema, setLeftSchema] = createSignal<SchemaData | null>(null)
	const [rightSchema, setRightSchema] = createSignal<SchemaData | null>(null)
	const [keyColumns, setKeyColumns] = createSignal<ComparisonColumnMapping[]>([])
	const [error, setError] = createSignal<string | null>(null)
	const [loading, setLoading] = createSignal(false)

	// Reset when dialog opens
	createEffect(() => {
		if (props.open) {
			const leftInit = createInitialSource(props.initialLeft)
			setLeft(leftInit)
			setRight(createInitialSource())
			setLeftSchema(null)
			setRightSchema(null)
			setKeyColumns([])
			setError(null)
			setLoading(false)

			// Load schema for pre-filled left source
			if (leftInit.connectionId) {
				loadSchema('left', leftInit.connectionId, leftInit.database || undefined)
			}
		}
	})

	async function loadSchema(side: 'left' | 'right', connectionId: string, database?: string) {
		try {
			const schema = await rpc.schema.load({ connectionId, database })
			if (side === 'left') {
				setLeftSchema(schema)
			} else {
				setRightSchema(schema)
			}
		} catch {
			// Schema load failed — user can still use query mode
		}
	}

	function handleConnectionChange(side: 'left' | 'right', connectionId: string) {
		const updater = side === 'left' ? setLeft : setRight
		updater((prev) => ({ ...prev, connectionId, database: '', schema: '', table: '' }))
		if (connectionId) {
			loadSchema(side, connectionId)
		} else {
			if (side === 'left') setLeftSchema(null)
			else setRightSchema(null)
		}
	}

	function handleDatabaseChange(side: 'left' | 'right', database: string) {
		const updater = side === 'left' ? setLeft : setRight
		const src = side === 'left' ? left() : right()
		updater((prev) => ({ ...prev, database, schema: '', table: '' }))
		if (src.connectionId) {
			loadSchema(side, src.connectionId, database || undefined)
		}
	}

	function handleSchemaChange(side: 'left' | 'right', schema: string) {
		const updater = side === 'left' ? setLeft : setRight
		updater((prev) => ({ ...prev, schema, table: '' }))
	}

	function getSchemas(schemaData: SchemaData | null): string[] {
		if (!schemaData) return []
		return schemaData.schemas.map((s) => s.name)
	}

	function getTables(schemaData: SchemaData | null, schema: string): string[] {
		if (!schemaData || !schema) return []
		return (schemaData.tables[schema] ?? []).map((t) => t.name)
	}

	function getColumns(schemaData: SchemaData | null, schema: string, table: string): ColumnInfo[] {
		if (!schemaData || !schema || !table) return []
		return schemaData.columns[`${schema}.${table}`] ?? []
	}

	function getAvailableDatabases(connectionId: string) {
		return connectionsStore.availableDatabases[connectionId] ?? []
	}

	// Auto-detect key columns when both sides have table selections
	createEffect(() => {
		const l = left()
		const r = right()
		if (l.type !== 'table' || r.type !== 'table') return
		if (!l.schema || !l.table || !r.schema || !r.table) return

		const leftCols = getColumns(leftSchema(), l.schema, l.table)
		const rightCols = getColumns(rightSchema(), r.schema, r.table)

		// Try primary keys first
		const leftPKs = leftCols.filter((c) => c.isPrimaryKey).map((c) => c.name)
		const rightPKs = rightCols.filter((c) => c.isPrimaryKey).map((c) => c.name)
		const rightPKSet = new Set(rightPKs.map((n) => n.toLowerCase()))

		const pkMappings: ComparisonColumnMapping[] = []
		for (const lpk of leftPKs) {
			if (rightPKSet.has(lpk.toLowerCase())) {
				const match = rightPKs.find((r) => r.toLowerCase() === lpk.toLowerCase())!
				pkMappings.push({ leftColumn: lpk, rightColumn: match })
			}
		}

		if (pkMappings.length > 0) {
			setKeyColumns(pkMappings)
		} else {
			// Fall back to first column with matching name
			const rightNameSet = new Set(rightCols.map((c) => c.name.toLowerCase()))
			for (const lc of leftCols) {
				if (rightNameSet.has(lc.name.toLowerCase())) {
					const match = rightCols.find((r) => r.name.toLowerCase() === lc.name.toLowerCase())!
					setKeyColumns([{ leftColumn: lc.name, rightColumn: match.name }])
					break
				}
			}
		}
	})

	function addKeyColumn() {
		setKeyColumns((prev) => [...prev, { leftColumn: '', rightColumn: '' }])
	}

	function removeKeyColumn(index: number) {
		setKeyColumns((prev) => prev.filter((_, i) => i !== index))
	}

	function updateKeyColumn(index: number, side: 'left' | 'right', value: string) {
		setKeyColumns((prev) =>
			prev.map((kc, i) =>
				i === index
					? side === 'left'
						? { ...kc, leftColumn: value }
						: { ...kc, rightColumn: value }
					: kc
			)
		)
	}

	function buildSource(state: SourceState): ComparisonSource {
		return {
			connectionId: state.connectionId,
			database: state.database || undefined,
			type: state.type,
			schema: state.type === 'table' ? state.schema : undefined,
			table: state.type === 'table' ? state.table : undefined,
			sql: state.type === 'query' ? state.sql : undefined,
		}
	}

	function validate(): string | null {
		const l = left()
		const r = right()

		if (!l.connectionId) return 'Select a connection for the left source'
		if (!r.connectionId) return 'Select a connection for the right source'

		if (l.type === 'table' && (!l.schema || !l.table)) return 'Select schema and table for the left source'
		if (r.type === 'table' && (!r.schema || !r.table)) return 'Select schema and table for the right source'
		if (l.type === 'query' && !l.sql.trim()) return 'Enter a SQL query for the left source'
		if (r.type === 'query' && !r.sql.trim()) return 'Enter a SQL query for the right source'

		if (keyColumns().length === 0) return 'Add at least one key column for matching rows'

		for (const kc of keyColumns()) {
			if (!kc.leftColumn || !kc.rightColumn) return 'All key column mappings must be filled'
		}

		return null
	}

	function handleCompare() {
		const validationError = validate()
		if (validationError) {
			setError(validationError)
			return
		}

		setError(null)
		const leftSource = buildSource(left())
		const rightSource = buildSource(right())
		// Column mappings will be auto-detected by the backend
		props.onCompare(leftSource, rightSource, keyColumns(), [])
	}

	function renderSourcePanel(
		side: 'left' | 'right',
		label: string,
		state: () => SourceState,
		setState: (fn: (prev: SourceState) => SourceState) => void,
		schemaData: () => SchemaData | null,
	) {
		return (
			<div class="comparison-dialog__source">
				<div class="comparison-dialog__source-header">{label}</div>

				<div class="comparison-dialog__field">
					<label class="comparison-dialog__label">Connection</label>
					<Select
						class="comparison-dialog__select"
						value={state().connectionId}
						onChange={(v) => handleConnectionChange(side, v)}
						options={[
							{ value: '', label: 'Select connection...' },
							...connectionsStore.connectedConnections.map((conn) => ({ value: conn.id, label: conn.name })),
						]}
					/>
				</div>

				<Show when={getAvailableDatabases(state().connectionId).length > 0}>
					<div class="comparison-dialog__field">
						<label class="comparison-dialog__label">Database</label>
						<Select
							class="comparison-dialog__select"
							value={state().database}
							onChange={(v) => handleDatabaseChange(side, v)}
							options={[{ value: '', label: 'Default' }, ...getAvailableDatabases(state().connectionId).map((db) => ({ value: db.name, label: db.name }))]}
						/>
					</div>
				</Show>

				<div class="comparison-dialog__field">
					<label class="comparison-dialog__label">Source type</label>
					<div class="comparison-dialog__type-group">
						<button
							class="comparison-dialog__type-btn"
							classList={{ 'comparison-dialog__type-btn--active': state().type === 'table' }}
							onClick={() => setState((prev) => ({ ...prev, type: 'table' }))}
						>
							Table
						</button>
						<button
							class="comparison-dialog__type-btn"
							classList={{ 'comparison-dialog__type-btn--active': state().type === 'query' }}
							onClick={() => setState((prev) => ({ ...prev, type: 'query' }))}
						>
							Query
						</button>
					</div>
				</div>

				<Show when={state().type === 'table'}>
					<div class="comparison-dialog__field">
						<label class="comparison-dialog__label">Schema</label>
						<Select
							class="comparison-dialog__select"
							value={state().schema}
							onChange={(v) => handleSchemaChange(side, v)}
							options={[{ value: '', label: 'Select schema...' }, ...getSchemas(schemaData()).map((s) => ({ value: s, label: s }))]}
						/>
					</div>

					<div class="comparison-dialog__field">
						<label class="comparison-dialog__label">Table</label>
						<Select
							class="comparison-dialog__select"
							value={state().table}
							onChange={(v) => setState((prev) => ({ ...prev, table: v }))}
							options={[{ value: '', label: 'Select table...' }, ...getTables(schemaData(), state().schema).map((t) => ({ value: t, label: t }))]}
						/>
					</div>
				</Show>

				<Show when={state().type === 'query'}>
					<div class="comparison-dialog__field comparison-dialog__field--column">
						<label class="comparison-dialog__label">SQL Query</label>
						<textarea
							class="comparison-dialog__textarea"
							value={state().sql}
							onInput={(e) => setState((prev) => ({ ...prev, sql: e.currentTarget.value }))}
							placeholder="SELECT * FROM ..."
							rows={4}
						/>
					</div>
				</Show>
			</div>
		)
	}

	// Collect column names for key column dropdowns
	function getLeftColumnNames(): string[] {
		const l = left()
		if (l.type === 'table') {
			return getColumns(leftSchema(), l.schema, l.table).map((c) => c.name)
		}
		return []
	}

	function getRightColumnNames(): string[] {
		const r = right()
		if (r.type === 'table') {
			return getColumns(rightSchema(), r.schema, r.table).map((c) => c.name)
		}
		return []
	}

	return (
		<Dialog open={props.open} title="Compare Data" onClose={props.onClose}>
			<div class="comparison-dialog">
				<div class="comparison-dialog__sources">
					{renderSourcePanel('left', 'Left Source', left, setLeft, leftSchema)}
					<div class="comparison-dialog__arrow">
						<Icon name="link" size={16} />
					</div>
					{renderSourcePanel('right', 'Right Source', right, setRight, rightSchema)}
				</div>

				<div class="comparison-dialog__section">
					<div class="comparison-dialog__section-header">
						<span>Key Columns (for matching rows)</span>
						<button class="comparison-dialog__add-btn" onClick={addKeyColumn}>
							<Icon name="plus" size={10} /> Add
						</button>
					</div>
					<div class="comparison-dialog__key-columns">
						<Show when={keyColumns().length === 0}>
							<div class="comparison-dialog__empty">
								No key columns configured. Add at least one to match rows.
							</div>
						</Show>
						<For each={keyColumns()}>
							{(kc, i) => (
								<div class="comparison-dialog__key-row">
									<Show
										when={getLeftColumnNames().length > 0}
										fallback={
											<input
												class="comparison-dialog__input"
												value={kc.leftColumn}
												onInput={(e) => updateKeyColumn(i(), 'left', e.currentTarget.value)}
												placeholder="Left column"
											/>
										}
									>
										<Select
											class="comparison-dialog__select"
											value={kc.leftColumn}
											onChange={(v) => updateKeyColumn(i(), 'left', v)}
											options={[{ value: '', label: 'Select...' }, ...getLeftColumnNames().map((col) => ({ value: col, label: col }))]}
										/>
									</Show>
									<span class="comparison-dialog__key-arrow">=</span>
									<Show
										when={getRightColumnNames().length > 0}
										fallback={
											<input
												class="comparison-dialog__input"
												value={kc.rightColumn}
												onInput={(e) => updateKeyColumn(i(), 'right', e.currentTarget.value)}
												placeholder="Right column"
											/>
										}
									>
										<Select
											class="comparison-dialog__select"
											value={kc.rightColumn}
											onChange={(v) => updateKeyColumn(i(), 'right', v)}
											options={[{ value: '', label: 'Select...' }, ...getRightColumnNames().map((col) => ({ value: col, label: col }))]}
										/>
									</Show>
									<button
										class="comparison-dialog__remove-btn"
										onClick={() => removeKeyColumn(i())}
										title="Remove"
									>
										<Icon name="close" size={10} />
									</button>
								</div>
							)}
						</For>
					</div>
				</div>

				<Show when={error()}>
					<div class="comparison-dialog__error">{error()}</div>
				</Show>

				<div class="comparison-dialog__actions">
					<button class="btn" onClick={props.onClose}>Cancel</button>
					<button class="btn btn--primary" onClick={handleCompare} disabled={loading()}>
						Compare
					</button>
				</div>
			</div>
		</Dialog>
	)
}
