import Check from 'lucide-solid/icons/check'
import Download from 'lucide-solid/icons/download'
import Pencil from 'lucide-solid/icons/pencil'
import Trash2 from 'lucide-solid/icons/trash-2'
import WrapText from 'lucide-solid/icons/wrap-text'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, Match, on, Show, Switch } from 'solid-js'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import { isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { ColumnFilter, GridColumnDef } from '../../../shared/types/grid'
import { getDataTypeLabel, isBooleanType, isJsonType } from '../../../shared/column-types'
import { tryFormatJson, displayValue } from '../../lib/value-format'
import RowDetailPanel from '../edit/RowDetailPanel'
import Resizer from '../layout/Resizer'
import AggregatePanel from './AggregatePanel'
import './SidePanel.css'

// ── Types ─────────────────────────────────────────

export type SidePanelMode =
	| { type: 'fk' }
	| { type: 'row-detail'; rowIndex: number }
	| { type: 'value'; rowIndex: number; column: GridColumnDef; value: unknown }
	| {
		type: 'selection'
		rowCount: number
		cellCount: number
		fallbackToAll: boolean
		rows: Record<string, unknown>[]
		columns: GridColumnDef[]
	}

export interface SidePanelProps {
	mode: SidePanelMode | null
	width: number
	onResize: (delta: number) => void
	onClose: () => void

	// FK panel props
	fkPanel?: {
		connectionId: string
		schema: string
		table: string
		database?: string
		columns: GridColumnDef[]
		row: Record<string, unknown> | null
		foreignKeys: ForeignKeyInfo[]
		loading: boolean
		readOnly: boolean
		rowLabel: string
		canGoPrev: boolean
		canGoNext: boolean
		onPrev: () => void
		onNext: () => void
		breadcrumbs: {
			schema: string
			table: string
			column: string
			value: unknown
		}[]
		onBack: () => void
		onSave: (changes: Record<string, unknown>) => Promise<void>
		onFkNavigate: (
			schema: string,
			table: string,
			column: string,
			value: unknown,
		) => void
		onReferencingNavigate: (
			schema: string,
			table: string,
			filters: ColumnFilter[],
		) => void
		onOpenInTab: () => void
		subtitle: string
		onClose: () => void
		panelWidth: number
		onPanelResize: (delta: number) => void
	}

	// Row detail props
	rowDetail?: {
		connectionId: string
		schema: string
		table: string
		database?: string
		columns: GridColumnDef[]
		row: Record<string, unknown> | null
		foreignKeys: ForeignKeyInfo[]
		readOnly: boolean
		rowLabel: string
		canGoPrev: boolean
		canGoNext: boolean
		onPrev: () => void
		onNext: () => void
		onSave: (changes: Record<string, unknown>) => void
		pendingChangedColumns: Set<string>
		onReferencingNavigate: (
			schema: string,
			table: string,
			filters: ColumnFilter[],
		) => void
		onOpenInTab: () => void
		subtitle: string
		onClose: () => void
	}

	// Value viewer props
	valueProps?: {
		readOnly: boolean
		onSave: (value: unknown) => void
	}

	// Selection props
	selectionProps?: {
		readOnly: boolean
		onDelete: () => void
		onExport: () => void
		onBatchEdit: () => void
		visibleColumns: GridColumnDef[]
	}
}

// ── Value Viewer ──────────────────────────────────

function ValueViewer(props: {
	column: GridColumnDef
	rowIndex: number
	value: unknown
	readOnly: boolean
	onSave: (value: unknown) => void
	onClose?: () => void
}) {
	const [editValue, setEditValue] = createSignal('')
	const [isEditing, setIsEditing] = createSignal(false)
	const [wordWrap, setWordWrap] = createSignal(true)

	const isJson = () => isJsonType(props.column.dataType) || tryFormatJson(props.value) !== null
	const isNull = () => props.value === null || props.value === undefined
	const isDefault = () => isSqlDefault(props.value)

	const formattedValue = () => {
		if (isNull()) return 'NULL'
		if (isDefault()) return 'DEFAULT'
		const jsonFormatted = tryFormatJson(props.value)
		if (jsonFormatted !== null) return jsonFormatted
		return displayValue(props.value)
	}

	const charCount = () => {
		if (isNull() || isDefault()) return null
		if (typeof props.value === 'string') return `${props.value.length} chars`
		return typeof props.value
	}

	createEffect(
		on(
			() => [props.rowIndex, props.column.name] as const,
			() => setIsEditing(false),
		),
	)

	function startEditing() {
		if (props.readOnly) return
		if (isNull() || isDefault()) {
			setEditValue('')
		} else {
			const jsonFormatted = tryFormatJson(props.value)
			setEditValue(jsonFormatted ?? displayValue(props.value))
		}
		setIsEditing(true)
	}

	function handleSave() {
		const raw = editValue()
		if (isJsonType(props.column.dataType)) {
			try {
				const parsed = JSON.parse(raw)
				props.onSave(parsed)
				setIsEditing(false)
				return
			} catch {
				/* save as string */
			}
		}
		if (isBooleanType(props.column.dataType)) {
			const lower = raw.toLowerCase().trim()
			if (lower === 'true' || lower === '1' || lower === 't') {
				props.onSave(true)
				setIsEditing(false)
				return
			}
			if (lower === 'false' || lower === '0' || lower === 'f') {
				props.onSave(false)
				setIsEditing(false)
				return
			}
		}
		props.onSave(raw)
		setIsEditing(false)
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			setIsEditing(false)
		}
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			handleSave()
		}
	}

	return (
		<div class="side-panel__value">
			<div class="side-panel__value-header">
				<div class="side-panel__value-title">
					<span class="side-panel__value-column">{props.column.name}</span>
					<span class="side-panel__value-type">
						{getDataTypeLabel(props.column.dataType)}
					</span>
				</div>
				<div class="side-panel__value-actions">
					<button
						class="side-panel__icon-btn"
						classList={{ 'side-panel__icon-btn--active': wordWrap() }}
						onClick={() => setWordWrap((w) => !w)}
						title="Toggle word wrap"
					>
						<WrapText size={14} />
					</button>
					<Show when={props.onClose}>
						<button
							class="side-panel__icon-btn"
							onClick={props.onClose}
							title="Close panel"
						>
							<X size={14} />
						</button>
					</Show>
				</div>
			</div>

			<div class="side-panel__value-body">
				<Show
					when={isEditing()}
					fallback={
						<>
							<pre
								class="side-panel__value-display"
								classList={{
									'side-panel__value-display--null': isNull(),
									'side-panel__value-display--json': isJson() && !isNull(),
									'side-panel__value-display--wrap': wordWrap(),
								}}
							>
								{formattedValue()}
							</pre>
							<Show when={!props.readOnly}>
								<div class="side-panel__value-edit-actions">
									<button class="side-panel__action-btn" onClick={startEditing}>
										<Pencil size={12} /> Edit
									</button>
									<button
										class="side-panel__action-btn"
										onClick={() => {
											props.onSave(null)
											setIsEditing(false)
										}}
									>
										NULL
									</button>
									<button
										class="side-panel__action-btn"
										onClick={() => {
											props.onSave(SQL_DEFAULT)
											setIsEditing(false)
										}}
									>
										DEFAULT
									</button>
								</div>
							</Show>
						</>
					}
				>
					<textarea
						class="side-panel__value-textarea"
						classList={{ 'side-panel__value-textarea--wrap': wordWrap() }}
						value={editValue()}
						onInput={(e) => setEditValue(e.currentTarget.value)}
						onKeyDown={handleKeyDown}
						autofocus
						spellcheck={false}
					/>
					<div class="side-panel__value-edit-actions">
						<button
							class="side-panel__action-btn side-panel__action-btn--primary"
							onClick={handleSave}
						>
							Save
						</button>
						<button
							class="side-panel__action-btn"
							onClick={() => setIsEditing(false)}
						>
							Cancel
						</button>
						<button
							class="side-panel__action-btn"
							onClick={() => {
								props.onSave(null)
								setIsEditing(false)
							}}
						>
							NULL
						</button>
						<button
							class="side-panel__action-btn"
							onClick={() => {
								props.onSave(SQL_DEFAULT)
								setIsEditing(false)
							}}
						>
							DEFAULT
						</button>
					</div>
				</Show>
			</div>

			<div class="side-panel__value-footer">
				<span>Row {props.rowIndex + 1}</span>
				<Show when={charCount()}>
					{(info) => <span>&middot; {info()}</span>}
				</Show>
			</div>
		</div>
	)
}

// ── Selection Panel ───────────────────────────────

function SelectionView(props: {
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]
	visibleColumns: GridColumnDef[]
	rowCount: number
	cellCount: number
	fallbackToAll: boolean
	readOnly: boolean
	onDelete: () => void
	onExport: () => void
	onBatchEdit: () => void
	onClose?: () => void
}) {
	return (
		<div class="side-panel__selection">
			<div class="side-panel__selection-header">
				<Check size={14} />
				<span>
					{props.fallbackToAll
						? `${props.rowCount} row${props.rowCount !== 1 ? 's' : ''} in current table`
						: `${props.rowCount} row${props.rowCount !== 1 ? 's' : ''}, ${props.cellCount} cell${props.cellCount !== 1 ? 's' : ''} selected`}
				</span>
				<Show when={props.onClose}>
					<button
						class="side-panel__icon-btn"
						style={{ 'margin-left': 'auto' }}
						onClick={props.onClose}
						title="Close panel"
					>
						<X size={14} />
					</button>
				</Show>
			</div>

			<div class="side-panel__selection-actions">
				<Show when={!props.readOnly}>
					<button
						class="side-panel__selection-btn side-panel__selection-btn--danger"
						onClick={props.onDelete}
					>
						<Trash2 size={13} /> Delete selected
					</button>
				</Show>
				<button class="side-panel__selection-btn" onClick={props.onExport}>
					<Download size={13} /> Export selected
				</button>
				<Show when={!props.readOnly}>
					<button class="side-panel__selection-btn" onClick={props.onBatchEdit}>
						<Pencil size={13} /> Batch edit
					</button>
				</Show>
			</div>

			<div class="side-panel__selection-stats">
				<AggregatePanel
					rows={props.rows}
					columns={props.columns}
					visibleColumns={props.visibleColumns}
				/>
			</div>
		</div>
	)
}

// ── Main SidePanel ────────────────────────────────

export default function SidePanel(props: SidePanelProps) {
	const valueMode = () => (props.mode?.type === 'value' ? props.mode : null)
	const selectionMode = () => props.mode?.type === 'selection' ? props.mode : null

	return (
		<Switch>
			<Match when={props.mode?.type === 'fk' && props.fkPanel}>
				<RowDetailPanel
					connectionId={props.fkPanel!.connectionId}
					schema={props.fkPanel!.schema}
					table={props.fkPanel!.table}
					database={props.fkPanel!.database}
					columns={props.fkPanel!.columns}
					row={props.fkPanel!.row}
					foreignKeys={props.fkPanel!.foreignKeys}
					width={props.width}
					loading={props.fkPanel!.loading}
					readOnly={props.fkPanel!.readOnly}
					rowLabel={props.fkPanel!.rowLabel}
					canGoPrev={props.fkPanel!.canGoPrev}
					canGoNext={props.fkPanel!.canGoNext}
					onPrev={props.fkPanel!.onPrev}
					onNext={props.fkPanel!.onNext}
					breadcrumbs={props.fkPanel!.breadcrumbs}
					onBack={props.fkPanel!.onBack}
					onSave={props.fkPanel!.onSave}
					onFkNavigate={props.fkPanel!.onFkNavigate}
					onReferencingNavigate={props.fkPanel!.onReferencingNavigate}
					onOpenInTab={props.fkPanel!.onOpenInTab}
					subtitle={props.fkPanel!.subtitle}
					onClose={props.fkPanel!.onClose}
					onResize={(delta) => props.onResize(delta)}
				/>
			</Match>

			<Match when={props.mode?.type === 'row-detail' && props.rowDetail}>
				<RowDetailPanel
					connectionId={props.rowDetail!.connectionId}
					schema={props.rowDetail!.schema}
					table={props.rowDetail!.table}
					database={props.rowDetail!.database}
					columns={props.rowDetail!.columns}
					row={props.rowDetail!.row}
					foreignKeys={props.rowDetail!.foreignKeys}
					width={props.width}
					readOnly={props.rowDetail!.readOnly}
					rowLabel={props.rowDetail!.rowLabel}
					canGoPrev={props.rowDetail!.canGoPrev}
					canGoNext={props.rowDetail!.canGoNext}
					onPrev={props.rowDetail!.onPrev}
					onNext={props.rowDetail!.onNext}
					onSave={props.rowDetail!.onSave}
					pendingChangedColumns={props.rowDetail!.pendingChangedColumns}
					onReferencingNavigate={props.rowDetail!.onReferencingNavigate}
					onOpenInTab={props.rowDetail!.onOpenInTab}
					subtitle={props.rowDetail!.subtitle}
					onClose={props.rowDetail!.onClose}
					onResize={(delta) => props.onResize(delta)}
				/>
			</Match>

			<Match when={valueMode() && props.valueProps}>
				<Resizer onResize={(delta) => props.onResize(-delta)} />
				<div class="side-panel" style={{ width: `${props.width}px` }}>
					<ValueViewer
						column={valueMode()!.column}
						rowIndex={valueMode()!.rowIndex}
						value={valueMode()!.value}
						readOnly={props.valueProps!.readOnly}
						onSave={props.valueProps!.onSave}
						onClose={props.onClose}
					/>
				</div>
			</Match>

			<Match when={selectionMode() && props.selectionProps}>
				<Resizer onResize={(delta) => props.onResize(-delta)} />
				<div class="side-panel" style={{ width: `${props.width}px` }}>
					<SelectionView
						rows={selectionMode()!.rows}
						columns={selectionMode()!.columns}
						visibleColumns={props.selectionProps!.visibleColumns}
						rowCount={selectionMode()!.rowCount}
						cellCount={selectionMode()!.cellCount}
						fallbackToAll={selectionMode()!.fallbackToAll}
						readOnly={props.selectionProps!.readOnly}
						onDelete={props.selectionProps!.onDelete}
						onExport={props.selectionProps!.onExport}
						onBatchEdit={props.selectionProps!.onBatchEdit}
						onClose={props.onClose}
					/>
				</div>
			</Match>
		</Switch>
	)
}
