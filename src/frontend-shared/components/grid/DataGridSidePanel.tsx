import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { generateUpdate } from '../../../shared/sql'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import type { ColumnFilter, GridColumnDef } from '../../../shared/types/grid'
import type { UpdateChange } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import type { FkTarget } from '../../stores/grid'
import { getSelectedRowIndices, gridStore, hasFullRowSelection } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import FkPeekPopover from './FkPeekPopover'
import type { SidePanelMode, SidePanelProps } from './SidePanel'
import SidePanel from './SidePanel'

export interface DataGridSidePanelProps {
	tabId: string
	connectionId: string
	currentSchema: string
	currentTable: string
	database?: string
	foreignKeys: () => ForeignKeyInfo[]
	fkMap: () => Map<string, FkTarget>
	visibleColumns: () => GridColumnDef[]
	isReadOnly: () => boolean
	onExportSelected: () => void
	onBatchEdit: () => void
}

export interface DataGridSidePanelHandle {
	openForSelection: () => void
	openSidePanel: () => void
	closeSidePanel: () => void
	handleFkClick: (
		rowIndex: number,
		column: string,
		anchorEl?: HTMLElement,
	) => void
	handlePkClick: (
		rowIndex: number,
		column: string,
		anchorEl?: HTMLElement,
	) => void
	sidePanelMode: () => SidePanelMode | null
	setSidePanelOpen: (open: boolean) => void
}

export default function DataGridSidePanel(
	props: DataGridSidePanelProps & {
		ref?: (handle: DataGridSidePanelHandle) => void
	},
) {
	const [sidePanelOpen, setSidePanelOpen] = createSignal(false)
	const [sidePanelWidth, setSidePanelWidth] = createSignal(420)

	const tab = () => gridStore.getTab(props.tabId)

	function getColumnIndex(column: string): number {
		return props.visibleColumns().findIndex((col) => col.name === column)
	}

	function getSingleSelectedCellContext() {
		const t = tab()
		if (
			!t
			|| t.selection.selectMode !== 'cells'
			|| t.selection.ranges.length !== 1
		) {
			return null
		}

		const range = t.selection.ranges[0]
		if (range.minRow !== range.maxRow || range.minCol !== range.maxCol) {
			return null
		}

		const column = props.visibleColumns()[range.minCol]
		const row = t.rows[range.minRow]
		if (!column || !row) return null

		return {
			rowIndex: range.minRow,
			column,
			value: row[column.name],
		}
	}

	const selectedFkContext = createMemo(() => {
		const cell = getSingleSelectedCellContext()
		if (!cell) return null

		const target = props.fkMap().get(cell.column.name)
		if (!target || cell.value === null || cell.value === undefined) return null

		return {
			...cell,
			target,
		}
	})

	function fkPanelMatchesSelection() {
		const panel = tab()?.fkPanel
		const fk = selectedFkContext()
		const root = panel?.breadcrumbs[0]
		if (!panel || !fk || !root) return false

		return (
			root.schema === fk.target.schema
			&& root.table === fk.target.table
			&& root.column === fk.target.column
			&& String(root.value) === String(fk.value)
		)
	}

	function openSelectedFkPanel() {
		const fk = selectedFkContext()
		if (!fk) return

		void gridStore.openFkPanel(props.tabId, fk.target.schema, fk.target.table, [
			{
				column: fk.target.column,
				operator: 'eq' as const,
				value: String(fk.value),
			},
		])
	}

	function closeSidePanel() {
		setSidePanelOpen(false)
		gridStore.closeFkPanel(props.tabId)
	}

	function setPanelOpen(open: boolean) {
		if (open) {
			setSidePanelOpen(true)
			return
		}

		closeSidePanel()
	}

	createEffect(() => {
		if (!sidePanelOpen()) return

		if (selectedFkContext()) {
			if (!fkPanelMatchesSelection()) {
				openSelectedFkPanel()
			}
			return
		}

		if (tab()?.fkPanel) {
			gridStore.closeFkPanel(props.tabId)
		}
	})

	const sidePanelMode = createMemo((): SidePanelMode | null => {
		const t = tab()
		if (!t) return null

		if (!sidePanelOpen()) return null

		const sel = t.selection
		if (sel.ranges.length === 0) {
			const snapshot = gridStore.getSelectionSnapshot(props.tabId, true)
			if (!snapshot) return null
			return {
				type: 'selection',
				rowCount: snapshot.rowCount,
				cellCount: snapshot.cellCount,
				fallbackToAll: snapshot.fallbackToAll,
				rows: snapshot.rows,
				columns: snapshot.columns,
			}
		}

		const selectedIndices = getSelectedRowIndices(sel)
		const singleCell = getSingleSelectedCellContext()
		const isSingleFullRow = selectedIndices.length === 1
			&& hasFullRowSelection(sel, props.visibleColumns().length)

		if (!singleCell) {
			if (selectedIndices.length === 0) return null

			if (isSingleFullRow) {
				return { type: 'row-detail', rowIndex: selectedIndices[0] }
			}

			const rows = selectedIndices
				.filter((i) => t.rows[i] != null)
				.map((i) => t.rows[i])
			const snapshot = gridStore.getSelectionSnapshot(props.tabId)
			return {
				type: 'selection',
				rowCount: snapshot?.rowCount ?? selectedIndices.length,
				cellCount: snapshot?.cellCount ?? rows.length * props.visibleColumns().length,
				fallbackToAll: snapshot?.fallbackToAll ?? false,
				rows: snapshot?.rows ?? rows,
				columns: snapshot?.columns ?? props.visibleColumns(),
			}
		}

		if (selectedFkContext()) {
			return { type: 'fk' }
		}

		if (singleCell.column.isPrimaryKey) {
			return { type: 'row-detail', rowIndex: singleCell.rowIndex }
		}

		return {
			type: 'value',
			rowIndex: singleCell.rowIndex,
			column: singleCell.column,
			value: singleCell.value,
		}
	})

	// ── Row Detail handlers ──

	function getRowDetailIndex(): number | null {
		const mode = sidePanelMode()
		return mode?.type === 'row-detail' ? mode.rowIndex : null
	}

	function openForSelection() {
		const t = tab()
		if (!t) return
		if (t.selection.ranges.length === 0) {
			const totalCols = props.visibleColumns().length
			if (t.rows.length > 0 && totalCols > 0) {
				gridStore.selectAll(props.tabId, t.rows.length, totalCols)
			}
		}
		setSidePanelOpen(true)
		if (selectedFkContext() && !fkPanelMatchesSelection()) {
			openSelectedFkPanel()
		}
	}

	function handleRowDetailSave(changes: Record<string, unknown>) {
		const idx = getRowDetailIndex()
		if (idx === null) return
		for (const [column, value] of Object.entries(changes)) {
			gridStore.setCellValue(props.tabId, idx, column, value)
		}
	}

	function handleRowDetailNavigate(direction: 'prev' | 'next') {
		const idx = getRowDetailIndex()
		if (idx === null) return
		const t = tab()
		if (!t) return
		const newIdx = direction === 'prev' ? idx - 1 : idx + 1
		if (newIdx < 0 || newIdx >= t.rows.length) return
		gridStore.selectFullRow(props.tabId, newIdx, props.visibleColumns().length)
	}

	function rowDetailPendingColumns(): Set<string> {
		const idx = getRowDetailIndex()
		if (idx === null) return new Set()
		const t = tab()
		if (!t) return new Set()
		const result = new Set<string>()
		for (const key of Object.keys(t.pendingChanges.cellEdits)) {
			const sepIdx = key.indexOf(':')
			if (sepIdx >= 0 && parseInt(key.substring(0, sepIdx)) === idx) {
				result.add(key.substring(sepIdx + 1))
			}
		}
		return result
	}

	function rowDetailOpenInTab() {
		const t = tab()
		const idx = getRowDetailIndex()
		if (!t || idx === null) return
		const row = t.rows[idx]
		if (!row) return
		const pkCols = t.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return
		const pks: Record<string, unknown> = {}
		for (const pk of pkCols) {
			if (row[pk.name] === null || row[pk.name] === undefined) return
			pks[pk.name] = row[pk.name]
		}
		tabsStore.openTab({
			type: 'row-detail',
			title: `${props.currentTable} — ${Object.values(pks).join(', ')}`,
			connectionId: props.connectionId,
			schema: props.currentSchema,
			table: props.currentTable,
			database: props.database,
			primaryKeys: pks,
		})
	}

	function rowDetailSubtitle(): string {
		const idx = getRowDetailIndex()
		if (idx === null) return ''
		const t = tab()
		if (!t) return ''
		const row = t.rows[idx]
		if (!row) return ''
		const pkCols = t.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return ''
		return pkCols
			.map(
				(pk) => `${pk.name}=${row[pk.name] === null ? 'NULL' : row[pk.name]}`,
			)
			.join(', ')
	}

	// ── FK panel handlers ──

	async function handleFkPanelSave(changes: Record<string, unknown>) {
		const t = tab()
		const panel = t?.fkPanel
		if (!panel) return
		const currentRow = panel.rows[panel.currentRowIndex]
		if (!currentRow) return
		const pkCols = panel.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return
		const pks: Record<string, unknown> = {}
		for (const pk of pkCols) pks[pk.name] = currentRow[pk.name]

		const dialect = connectionsStore.getDialect(props.connectionId)
		const change: UpdateChange = {
			type: 'update',
			schema: panel.schema,
			table: panel.table,
			primaryKeys: pks,
			values: changes,
		}
		const stmt = generateUpdate(change, dialect)
		await rpc.query.execute({
			connectionId: props.connectionId,
			sql: '',
			queryId: `fk-panel-save-${props.tabId}`,
			database: props.database,
			statements: [{ sql: stmt.sql, params: stmt.params }],
		})
		await gridStore.refreshFkPanel(props.tabId)
	}

	function fkPanelOpenInTab() {
		const t = tab()
		const panel = t?.fkPanel
		if (!panel) return
		const currentRow = panel.rows[panel.currentRowIndex]
		if (!currentRow) return
		const pkCols = panel.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length > 0) {
			const pks: Record<string, unknown> = {}
			for (const pk of pkCols) pks[pk.name] = currentRow[pk.name]
			tabsStore.openTab({
				type: 'row-detail',
				title: `${panel.table} — ${Object.values(pks).join(', ')}`,
				connectionId: props.connectionId,
				schema: panel.schema,
				table: panel.table,
				database: props.database,
				primaryKeys: pks,
			})
		} else {
			const newTabId = tabsStore.openTab({
				type: 'data-grid',
				title: panel.table,
				connectionId: props.connectionId,
				schema: panel.schema,
				table: panel.table,
				database: props.database,
			})
			gridStore
				.loadTableData(
					newTabId,
					props.connectionId,
					panel.schema,
					panel.table,
					props.database,
				)
				.then(() => {
					for (const f of panel.filters) {
						gridStore.setFilter(newTabId, f)
					}
				})
		}
		gridStore.closeFkPanel(props.tabId)
	}

	function fkPanelSubtitle(): string {
		const panel = tab()?.fkPanel
		if (!panel || panel.filters.length === 0) return ''
		return panel.filters.map((f) => `${f.column} = ${f.value}`).join(', ')
	}

	function fkPanelRowLabel(): string {
		const panel = tab()?.fkPanel
		if (!panel) return ''
		const global = (panel.currentPage - 1) * panel.pageSize + panel.currentRowIndex + 1
		return panel.totalCount !== null ? `${global} / ${panel.totalCount}` : `${global}`
	}

	function fkPanelCanPrev(): boolean {
		const panel = tab()?.fkPanel
		if (!panel) return false
		return panel.currentRowIndex > 0 || panel.currentPage > 1
	}

	function fkPanelCanNext(): boolean {
		const panel = tab()?.fkPanel
		if (!panel) return false
		if (panel.totalCount !== null) {
			const totalPages = Math.max(1, Math.ceil(panel.totalCount / panel.pageSize))
			return panel.currentRowIndex < panel.rows.length - 1 || panel.currentPage < totalPages
		}
		// Count unknown: can go next if there are more rows on this page or more rows available
		return panel.currentRowIndex < panel.rows.length - 1 || panel.rows.length >= panel.pageSize
	}

	function fkPanelPrev() {
		const panel = tab()?.fkPanel
		if (!panel) return
		if (panel.currentRowIndex > 0) {
			gridStore.fkPanelSetRowIndex(props.tabId, panel.currentRowIndex - 1)
		} else if (panel.currentPage > 1) {
			gridStore.fkPanelSetPage(props.tabId, panel.currentPage - 1)
		}
	}

	function fkPanelNext() {
		const panel = tab()?.fkPanel
		if (!panel) return
		if (panel.currentRowIndex < panel.rows.length - 1) {
			gridStore.fkPanelSetRowIndex(props.tabId, panel.currentRowIndex + 1)
		} else {
			const totalPages = panel.totalCount !== null
				? Math.max(1, Math.ceil(panel.totalCount / panel.pageSize))
				: Infinity
			if (panel.currentPage < totalPages) {
				gridStore.fkPanelSetPage(props.tabId, panel.currentPage + 1)
			}
		}
	}

	// ── FK navigation ──

	function handleFkClick(
		rowIndex: number,
		column: string,
		anchorEl?: HTMLElement,
	) {
		const t = tab()
		if (!t) return

		const colIndex = getColumnIndex(column)
		if (colIndex >= 0) {
			gridStore.selectCell(props.tabId, rowIndex, colIndex)
		}

		const target = props.fkMap().get(column)
		if (!target) return
		const value = t.rows[rowIndex]?.[column]
		if (value === null || value === undefined) return

		let anchorRect = { top: 200, left: 200, bottom: 220, right: 300 }
		if (anchorEl) {
			const r = anchorEl.getBoundingClientRect()
			anchorRect = {
				top: r.top,
				left: r.left,
				bottom: r.bottom,
				right: r.right,
			}
		}

		void gridStore.openFkPeek(
			props.tabId,
			anchorRect,
			target.schema,
			target.table,
			target.column,
			value,
		)
	}

	function handlePkClick(
		rowIndex: number,
		_column: string,
		anchorEl?: HTMLElement,
	) {
		const colIndex = getColumnIndex(_column)
		if (colIndex >= 0) {
			gridStore.selectCell(props.tabId, rowIndex, colIndex)
		}

		let anchorRect = { top: 200, left: 200, bottom: 220, right: 300 }
		if (anchorEl) {
			const r = anchorEl.getBoundingClientRect()
			anchorRect = {
				top: r.top,
				left: r.left,
				bottom: r.bottom,
				right: r.right,
			}
		}
		gridStore.openPkPeek(props.tabId, rowIndex, anchorRect)
	}

	function openReferencingTab(
		schema: string,
		table: string,
		filters: ColumnFilter[],
	) {
		const newTabId = tabsStore.openTab({
			type: 'data-grid',
			title: table,
			connectionId: props.connectionId,
			schema,
			table,
			database: props.database,
		})
		gridStore
			.loadTableData(
				newTabId,
				props.connectionId,
				schema,
				table,
				props.database,
			)
			.then(() => {
				for (const f of filters) {
					gridStore.setFilter(newTabId, f)
				}
			})
	}

	// ── Build grouped props for SidePanel ──

	function buildFkPanelProps(): SidePanelProps['fkPanel'] {
		const fk = selectedFkContext()
		if (!fk) return undefined

		const panel = tab()?.fkPanel
		const root = panel?.breadcrumbs[0]
		const panelMatches = !!panel
			&& !!root
			&& root.schema === fk.target.schema
			&& root.table === fk.target.table
			&& root.column === fk.target.column
			&& String(root.value) === String(fk.value)

		return {
			connectionId: props.connectionId,
			schema: fk.target.schema,
			table: fk.target.table,
			database: props.database,
			columns: panelMatches ? panel.columns : [],
			row: panelMatches
				? (panel.rows[panel.currentRowIndex] ?? null)
				: null,
			foreignKeys: panelMatches ? panel.foreignKeys : [],
			loading: panelMatches ? panel.loading : true,
			readOnly: props.isReadOnly(),
			rowLabel: panelMatches ? fkPanelRowLabel() : '',
			canGoPrev: panelMatches ? fkPanelCanPrev() : false,
			canGoNext: panelMatches ? fkPanelCanNext() : false,
			onPrev: fkPanelPrev,
			onNext: fkPanelNext,
			breadcrumbs: panelMatches
				? panel.breadcrumbs
				: [
					{
						schema: fk.target.schema,
						table: fk.target.table,
						column: fk.target.column,
						value: fk.value,
					},
				],
			onBack: () => {
				if (panelMatches) void gridStore.fkPanelBack(props.tabId)
			},
			onSave: handleFkPanelSave,
			onFkNavigate: (schema, table, column, value) => {
				void gridStore.fkPanelNavigate(
					props.tabId,
					schema,
					table,
					column,
					value,
				)
			},
			onReferencingNavigate: openReferencingTab,
			onOpenInTab: fkPanelOpenInTab,
			subtitle: panelMatches ? fkPanelSubtitle() : '',
			onClose: closeSidePanel,
			panelWidth: panelMatches ? panel.width : 500,
			onPanelResize: (delta) =>
				gridStore.fkPanelResize(
					props.tabId,
					(panel?.width ?? 500) + delta,
				),
		}
	}

	function buildRowDetailProps(): SidePanelProps['rowDetail'] {
		const mode = sidePanelMode()
		if (mode?.type !== 'row-detail') return undefined

		const tabData = tab()
		if (!tabData) return undefined

		const idx = mode.rowIndex
		return {
			connectionId: props.connectionId,
			schema: props.currentSchema,
			table: props.currentTable,
			database: props.database,
			columns: tabData.columns,
			row: tabData.rows[idx] ?? null,
			foreignKeys: props.foreignKeys(),
			readOnly: props.isReadOnly(),
			rowLabel: `Row ${idx + 1} of ${tabData.rows.length}`,
			canGoPrev: idx > 0,
			canGoNext: idx < tabData.rows.length - 1,
			onPrev: () => handleRowDetailNavigate('prev'),
			onNext: () => handleRowDetailNavigate('next'),
			onSave: handleRowDetailSave,
			pendingChangedColumns: rowDetailPendingColumns(),
			onReferencingNavigate: openReferencingTab,
			onOpenInTab: rowDetailOpenInTab,
			subtitle: rowDetailSubtitle(),
			onClose: closeSidePanel,
		}
	}

	function buildValueProps(): SidePanelProps['valueProps'] {
		const mode = sidePanelMode()
		if (mode?.type !== 'value') return undefined

		return {
			readOnly: props.isReadOnly(),
			onSave: (value) => {
				gridStore.setCellValue(
					props.tabId,
					mode.rowIndex,
					mode.column.name,
					value,
				)
			},
		}
	}

	function buildSelectionProps(): SidePanelProps['selectionProps'] {
		const mode = sidePanelMode()
		if (mode?.type !== 'selection') return undefined

		return {
			readOnly: props.isReadOnly(),
			onDelete: () => gridStore.deleteSelectedRows(props.tabId),
			onExport: props.onExportSelected,
			onBatchEdit: props.onBatchEdit,
			visibleColumns: mode.columns,
		}
	}

	// Expose handle to parent
	props.ref?.({
		openForSelection,
		openSidePanel: () => setPanelOpen(true),
		closeSidePanel,
		handleFkClick,
		handlePkClick,
		sidePanelMode,
		setSidePanelOpen: setPanelOpen,
	})

	const mode = sidePanelMode
	const tabState = tab

	return (
		<>
			{/* Side panel content */}
			<Show when={mode()}>
				<SidePanelContent
					mode={mode}
					width={sidePanelWidth()}
					onResize={(delta) => setSidePanelWidth((w) => Math.min(1200, Math.max(250, w - delta)))}
					onClose={closeSidePanel}
					fkPanel={buildFkPanelProps}
					rowDetail={buildRowDetailProps}
					valueProps={buildValueProps}
					selectionProps={buildSelectionProps}
				/>
			</Show>

			{/* FK Peek Popover */}
			<Show when={tabState()?.fkPeek}>
				<FkPeekPopover
					peek={tabState()!.fkPeek!}
					onClose={() => gridStore.closeFkPeek(props.tabId)}
					onNavigate={(schema, table, column, value) => {
						gridStore.fkPeekNavigate(props.tabId, schema, table, column, value)
					}}
					onBack={() => gridStore.fkPeekBack(props.tabId)}
					onFilter={tabState()!.fkPeek!.breadcrumbs.length === 1
							&& !tabState()!.fkPeek!.breadcrumbs[0].column
						? (column, value, exclude) => {
							const v = value === null || value === undefined
								? null
								: String(value)
							gridStore.setFilter(props.tabId, {
								column,
								operator: v === null
									? exclude
										? 'isNotNull'
										: 'isNull'
									: exclude
									? 'neq'
									: 'eq',
								value: v,
							})
							gridStore.closeFkPeek(props.tabId)
						}
						: undefined}
					onOpenInPanel={() => {
						const peek = tabState()?.fkPeek
						if (!peek) return

						const bc = peek.breadcrumbs[peek.breadcrumbs.length - 1]
						if (!bc) return

						if (peek.breadcrumbs.length === 1 && !bc.column) {
							const t = tabState()
							if (!t || !peek.rows[0]) return

							const pkRow = peek.rows[0]
							const rowIdx = t.rows.findIndex((r) => t.columns.every((c) => c.isPrimaryKey ? r[c.name] === pkRow[c.name] : true))
							if (rowIdx >= 0) {
								gridStore.closeFkPeek(props.tabId)
								gridStore.selectFullRow(
									props.tabId,
									rowIdx,
									props.visibleColumns().length,
								)
								setSidePanelOpen(true)
							}
							return
						}

						void gridStore.openFkPanel(props.tabId, peek.schema, peek.table, [
							{
								column: bc.column,
								operator: 'eq' as const,
								value: String(bc.value),
							},
						])
						setSidePanelOpen(true)
					}}
					onOpenInTab={() => {
						const peek = tabState()?.fkPeek
						if (!peek) return

						const bc = peek.breadcrumbs[peek.breadcrumbs.length - 1]
						if (!bc) return

						if (peek.breadcrumbs.length === 1 && !bc.column && peek.rows[0]) {
							const row = peek.rows[0]
							const pkCols = peek.columns.filter((c) => c.isPrimaryKey)
							if (pkCols.length > 0) {
								const pks: Record<string, unknown> = {}
								for (const pk of pkCols) {
									if (row[pk.name] === null || row[pk.name] === undefined) {
										return
									}
									pks[pk.name] = row[pk.name]
								}
								tabsStore.openTab({
									type: 'row-detail',
									title: `${peek.table} — ${Object.values(pks).join(', ')}`,
									connectionId: props.connectionId,
									schema: peek.schema,
									table: peek.table,
									database: props.database,
									primaryKeys: pks,
								})
							}
							gridStore.closeFkPeek(props.tabId)
							return
						}

						const newTabId = tabsStore.openTab({
							type: 'data-grid',
							title: peek.table,
							connectionId: props.connectionId,
							schema: peek.schema,
							table: peek.table,
							database: props.database,
						})
						gridStore.closeFkPeek(props.tabId)
						gridStore
							.loadTableData(
								newTabId,
								props.connectionId,
								peek.schema,
								peek.table,
								props.database,
							)
							.then(() => {
								gridStore.setFilter(newTabId, {
									column: bc.column,
									operator: 'eq',
									value: String(bc.value),
								})
							})
					}}
				/>
			</Show>
		</>
	)
}

// Inner component that ensures reactive reads happen inside the render scope.
// Receives builder functions (accessors) for each mode's props, calls them
// reactively so SidePanel always sees fresh data.
function SidePanelContent(props: {
	mode: () => SidePanelMode | null
	width: number
	onResize: (delta: number) => void
	onClose: () => void
	fkPanel: () => SidePanelProps['fkPanel']
	rowDetail: () => SidePanelProps['rowDetail']
	valueProps: () => SidePanelProps['valueProps']
	selectionProps: () => SidePanelProps['selectionProps']
}) {
	return (
		<SidePanel
			mode={props.mode()}
			width={props.width}
			onResize={props.onResize}
			onClose={props.onClose}
			fkPanel={props.fkPanel()}
			rowDetail={props.rowDetail()}
			valueProps={props.valueProps()}
			selectionProps={props.selectionProps()}
		/>
	)
}
