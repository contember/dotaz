import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs'
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import type { ColumnInfo, ForeignKeyInfo, SchemaData, TableInfo } from '../../../shared/types/database'
import { connectionsStore } from '../../stores/connections'
import { tabsStore } from '../../stores/tabs'
import Icon from '../common/Icon'
import './ErDiagram.css'

interface ErDiagramProps {
	tabId: string
	connectionId: string
	schema: string
	database?: string
}

interface TableNode {
	id: string
	schema: string
	name: string
	x: number
	y: number
	width: number
	height: number
	columns: ColumnInfo[]
	fkColumns: Set<string>
}

interface Edge {
	id: string
	sourceTable: string
	sourceColumns: string[]
	targetTable: string
	targetColumns: string[]
	label: string
	sections: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }>
}

const TABLE_HEADER_HEIGHT = 34
const COLUMN_ROW_HEIGHT = 22
const TABLE_PADDING_Y = 8
const TABLE_MIN_WIDTH = 180
const CHAR_WIDTH = 7
const MAX_TABLES = 50

export default function ErDiagram(props: ErDiagramProps) {
	const [nodes, setNodes] = createSignal<TableNode[]>([])
	const [edges, setEdges] = createSignal<Edge[]>([])
	const [highlighted, setHighlighted] = createSignal<string | null>(null)
	const [compact, setCompact] = createSignal(false)
	const [zoom, setZoom] = createSignal(1)
	const [pan, setPan] = createSignal({ x: 40, y: 40 })
	const [isPanning, setIsPanning] = createSignal(false)
	const [layoutReady, setLayoutReady] = createSignal(false)

	let canvasWrapRef: HTMLDivElement | undefined
	let panStart = { x: 0, y: 0 }
	let panOrigin = { x: 0, y: 0 }

	const schemaData = createMemo<SchemaData | undefined>(() =>
		connectionsStore.getSchemaData(props.connectionId, props.database),
	)

	const tables = createMemo<TableInfo[]>(() => {
		const data = schemaData()
		if (!data) return []
		const schemaTables = data.tables[props.schema] ?? []
		return schemaTables.filter((t) => t.type === 'table').slice(0, MAX_TABLES)
	})

	const elk = new ELK()

	function estimateTableWidth(table: TableInfo, columns: ColumnInfo[]): number {
		const headerWidth = table.name.length * (CHAR_WIDTH + 1) + 30
		let maxColWidth = 0
		for (const col of columns) {
			const colWidth = col.name.length * CHAR_WIDTH + 80
			if (colWidth > maxColWidth) maxColWidth = colWidth
		}
		return Math.max(TABLE_MIN_WIDTH, headerWidth, maxColWidth)
	}

	function estimateTableHeight(columns: ColumnInfo[]): number {
		const colCount = compact() ? 0 : columns.length
		return TABLE_HEADER_HEIGHT + TABLE_PADDING_Y + colCount * COLUMN_ROW_HEIGHT
	}

	async function computeLayout() {
		const data = schemaData()
		const tbls = tables()
		if (!data || tbls.length === 0) {
			setNodes([])
			setEdges([])
			setLayoutReady(true)
			return
		}

		const tableSet = new Set(tbls.map((t) => `${t.schema}.${t.name}`))

		// Collect all FKs between tables in the set
		const allEdges: Array<{ source: string; target: string; fk: ForeignKeyInfo }> = []
		const fkColumnsByTable = new Map<string, Set<string>>()

		for (const table of tbls) {
			const key = `${table.schema}.${table.name}`
			const fks = data.foreignKeys[key] ?? []
			for (const fk of fks) {
				const targetKey = `${fk.referencedSchema}.${fk.referencedTable}`
				if (tableSet.has(targetKey)) {
					allEdges.push({ source: key, target: targetKey, fk })
					if (!fkColumnsByTable.has(key)) fkColumnsByTable.set(key, new Set())
					for (const col of fk.columns) {
						fkColumnsByTable.get(key)!.add(col)
					}
				}
			}
		}

		// Build ELK graph
		const elkNodes: ElkNode[] = tbls.map((table) => {
			const key = `${table.schema}.${table.name}`
			const columns = data.columns[key] ?? []
			return {
				id: key,
				width: estimateTableWidth(table, columns),
				height: estimateTableHeight(columns),
			}
		})

		const elkEdges: ElkExtendedEdge[] = allEdges.map((e, i) => ({
			id: `edge-${i}`,
			sources: [e.source],
			targets: [e.target],
		}))

		try {
			const layout = await elk.layout({
				id: 'root',
				layoutOptions: {
					'elk.algorithm': 'layered',
					'elk.direction': 'RIGHT',
					'elk.spacing.nodeNode': '40',
					'elk.layered.spacing.nodeNodeBetweenLayers': '60',
					'elk.edgeRouting': 'ORTHOGONAL',
					'elk.layered.mergeEdges': 'true',
				},
				children: elkNodes,
				edges: elkEdges,
			})

			const layoutNodes: TableNode[] = (layout.children ?? []).map((n) => {
				const key = n.id
				const columns = data.columns[key] ?? []
				return {
					id: key,
					schema: key.split('.')[0],
					name: key.split('.').slice(1).join('.'),
					x: n.x ?? 0,
					y: n.y ?? 0,
					width: n.width ?? TABLE_MIN_WIDTH,
					height: n.height ?? TABLE_HEADER_HEIGHT,
					columns,
					fkColumns: fkColumnsByTable.get(key) ?? new Set(),
				}
			})

			const layoutEdges: Edge[] = (layout.edges ?? []).map((e, i) => {
				const edgeData = allEdges[i]
				return {
					id: e.id,
					sourceTable: edgeData.source,
					sourceColumns: edgeData.fk.columns,
					targetTable: edgeData.target,
					targetColumns: edgeData.fk.referencedColumns,
					label: edgeData.fk.name,
					sections: (e as ElkExtendedEdge).sections ?? [],
				}
			})

			setNodes(layoutNodes)
			setEdges(layoutEdges)
			setLayoutReady(true)
		} catch {
			setNodes([])
			setEdges([])
			setLayoutReady(true)
		}
	}

	// Re-layout when schema data or compact mode changes
	createEffect(on([schemaData, compact], () => {
		setLayoutReady(false)
		computeLayout()
	}))

	// Pan & zoom handlers
	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return
		setIsPanning(true)
		panStart = { x: e.clientX, y: e.clientY }
		panOrigin = pan()
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isPanning()) return
		setPan({
			x: panOrigin.x + (e.clientX - panStart.x),
			y: panOrigin.y + (e.clientY - panStart.y),
		})
	}

	function handleMouseUp() {
		setIsPanning(false)
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault()
		const delta = e.deltaY > 0 ? 0.9 : 1.1
		const newZoom = Math.min(3, Math.max(0.1, zoom() * delta))

		// Zoom toward cursor
		const rect = canvasWrapRef!.getBoundingClientRect()
		const cx = e.clientX - rect.left
		const cy = e.clientY - rect.top
		const currentPan = pan()

		setPan({
			x: cx - (cx - currentPan.x) * (newZoom / zoom()),
			y: cy - (cy - currentPan.y) * (newZoom / zoom()),
		})
		setZoom(newZoom)
	}

	onMount(() => {
		document.addEventListener('mousemove', handleMouseMove)
		document.addEventListener('mouseup', handleMouseUp)
	})
	onCleanup(() => {
		document.removeEventListener('mousemove', handleMouseMove)
		document.removeEventListener('mouseup', handleMouseUp)
	})

	function resetView() {
		setZoom(1)
		setPan({ x: 40, y: 40 })
	}

	function zoomIn() {
		setZoom((z) => Math.min(3, z * 1.2))
	}

	function zoomOut() {
		setZoom((z) => Math.max(0.1, z / 1.2))
	}

	function handleTableClick(node: TableNode) {
		setHighlighted((prev) => (prev === node.id ? null : node.id))
	}

	function handleTableDblClick(node: TableNode) {
		tabsStore.openTab({
			type: 'data-grid',
			title: node.name,
			connectionId: props.connectionId,
			schema: node.schema,
			table: node.name,
			database: props.database,
		})
	}

	const highlightedEdges = createMemo(() => {
		const h = highlighted()
		if (!h) return new Set<string>()
		return new Set(
			edges()
				.filter((e) => e.sourceTable === h || e.targetTable === h)
				.map((e) => e.id),
		)
	})

	const highlightedTables = createMemo(() => {
		const h = highlighted()
		if (!h) return new Set<string>()
		const set = new Set<string>([h])
		for (const e of edges()) {
			if (e.sourceTable === h) set.add(e.targetTable)
			if (e.targetTable === h) set.add(e.sourceTable)
		}
		return set
	})

	// SVG viewport size
	const svgSize = createMemo(() => {
		let maxX = 0
		let maxY = 0
		for (const n of nodes()) {
			const right = n.x + n.width
			const bottom = n.y + n.height
			if (right > maxX) maxX = right
			if (bottom > maxY) maxY = bottom
		}
		return { width: maxX + 100, height: maxY + 100 }
	})

	function edgePath(edge: Edge): string {
		const parts: string[] = []
		for (const section of edge.sections) {
			parts.push(`M ${section.startPoint.x} ${section.startPoint.y}`)
			if (section.bendPoints) {
				for (const bp of section.bendPoints) {
					parts.push(`L ${bp.x} ${bp.y}`)
				}
			}
			parts.push(`L ${section.endPoint.x} ${section.endPoint.y}`)
		}
		return parts.join(' ')
	}

	async function exportAs(format: 'svg' | 'png') {
		const svgEl = canvasWrapRef?.querySelector('.er-diagram__edges') as SVGSVGElement | null
		if (!svgEl) return

		// Build a standalone SVG with table nodes rendered as SVG elements
		const size = svgSize()
		const ns = 'http://www.w3.org/2000/svg'
		const svg = document.createElementNS(ns, 'svg')
		svg.setAttribute('xmlns', ns)
		svg.setAttribute('width', String(size.width))
		svg.setAttribute('height', String(size.height))
		svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)

		// Background
		const bg = document.createElementNS(ns, 'rect')
		bg.setAttribute('width', '100%')
		bg.setAttribute('height', '100%')
		bg.setAttribute('fill', '#1e1e1e')
		svg.appendChild(bg)

		// Edges
		for (const edge of edges()) {
			const path = document.createElementNS(ns, 'path')
			path.setAttribute('d', edgePath(edge))
			path.setAttribute('fill', 'none')
			path.setAttribute('stroke', '#555')
			path.setAttribute('stroke-width', '1.5')
			svg.appendChild(path)
		}

		// Table nodes
		for (const node of nodes()) {
			const g = document.createElementNS(ns, 'g')
			g.setAttribute('transform', `translate(${node.x}, ${node.y})`)

			// Background rect
			const rect = document.createElementNS(ns, 'rect')
			rect.setAttribute('width', String(node.width))
			rect.setAttribute('height', String(node.height))
			rect.setAttribute('rx', '6')
			rect.setAttribute('fill', '#2d2d2d')
			rect.setAttribute('stroke', '#444')
			g.appendChild(rect)

			// Header bg
			const headerBg = document.createElementNS(ns, 'rect')
			headerBg.setAttribute('width', String(node.width))
			headerBg.setAttribute('height', String(TABLE_HEADER_HEIGHT))
			headerBg.setAttribute('rx', '6')
			headerBg.setAttribute('fill', '#383838')
			g.appendChild(headerBg)

			// Header text
			const headerText = document.createElementNS(ns, 'text')
			headerText.setAttribute('x', '10')
			headerText.setAttribute('y', '22')
			headerText.setAttribute('fill', '#e0e0e0')
			headerText.setAttribute('font-size', '13')
			headerText.setAttribute('font-weight', '600')
			headerText.setAttribute('font-family', 'system-ui, sans-serif')
			headerText.textContent = node.name
			g.appendChild(headerText)

			// Columns
			if (!compact()) {
				node.columns.forEach((col, ci) => {
					const cy = TABLE_HEADER_HEIGHT + TABLE_PADDING_Y / 2 + ci * COLUMN_ROW_HEIGHT + 14
					const colText = document.createElementNS(ns, 'text')
					colText.setAttribute('x', '28')
					colText.setAttribute('y', String(cy))
					colText.setAttribute('fill', '#ccc')
					colText.setAttribute('font-size', '12')
					colText.setAttribute('font-family', 'system-ui, sans-serif')
					colText.textContent = col.name
					g.appendChild(colText)

					// PK/FK indicator
					if (col.isPrimaryKey) {
						const pkText = document.createElementNS(ns, 'text')
						pkText.setAttribute('x', '10')
						pkText.setAttribute('y', String(cy))
						pkText.setAttribute('fill', '#e5a100')
						pkText.setAttribute('font-size', '11')
						pkText.setAttribute('font-family', 'system-ui, sans-serif')
						pkText.textContent = 'PK'
						g.appendChild(pkText)
					} else if (node.fkColumns.has(col.name)) {
						const fkText = document.createElementNS(ns, 'text')
						fkText.setAttribute('x', '10')
						fkText.setAttribute('y', String(cy))
						fkText.setAttribute('fill', '#58a6ff')
						fkText.setAttribute('font-size', '11')
						fkText.setAttribute('font-family', 'system-ui, sans-serif')
						fkText.textContent = 'FK'
						g.appendChild(fkText)
					}

					// Type
					const typeText = document.createElementNS(ns, 'text')
					typeText.setAttribute('x', String(node.width - 10))
					typeText.setAttribute('y', String(cy))
					typeText.setAttribute('fill', '#888')
					typeText.setAttribute('font-size', '11')
					typeText.setAttribute('text-anchor', 'end')
					typeText.setAttribute('font-family', 'system-ui, sans-serif')
					typeText.textContent = col.dataType
					g.appendChild(typeText)
				})
			}

			svg.appendChild(g)
		}

		const svgString = new XMLSerializer().serializeToString(svg)

		if (format === 'svg') {
			const blob = new Blob([svgString], { type: 'image/svg+xml' })
			downloadBlob(blob, 'er-diagram.svg')
		} else {
			const canvas = document.createElement('canvas')
			const scale = 2
			canvas.width = size.width * scale
			canvas.height = size.height * scale
			const ctx = canvas.getContext('2d')!
			ctx.scale(scale, scale)

			const img = new Image()
			img.onload = () => {
				ctx.drawImage(img, 0, 0)
				canvas.toBlob((blob) => {
					if (blob) downloadBlob(blob, 'er-diagram.png')
				}, 'image/png')
			}
			img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`
		}
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = filename
		a.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div class="er-diagram">
			<div class="er-diagram__toolbar">
				<div class="er-diagram__toolbar-group">
					<button class={compact() ? 'active' : ''} onClick={() => setCompact((v) => !v)}>
						{compact() ? 'Show Columns' : 'Hide Columns'}
					</button>
				</div>
				<div class="er-diagram__toolbar-separator" />
				<div class="er-diagram__toolbar-group">
					<button onClick={() => exportAs('svg')}>
						<Icon name="export" size={14} />
						SVG
					</button>
					<button onClick={() => exportAs('png')}>
						<Icon name="export" size={14} />
						PNG
					</button>
				</div>
				<div class="er-diagram__toolbar-separator" />
				<div class="er-diagram__toolbar-group">
					<button onClick={resetView}>Fit</button>
				</div>
			</div>

			<Show when={layoutReady()} fallback={<div class="er-diagram__empty">Computing layout...</div>}>
				<Show when={nodes().length > 0} fallback={<div class="er-diagram__empty">No tables found in schema "{props.schema}"</div>}>
					<div
						ref={canvasWrapRef}
						class={`er-diagram__canvas-wrap${isPanning() ? ' grabbing' : ''}`}
						onMouseDown={handleMouseDown}
						onWheel={handleWheel}
					>
						<div
							class="er-diagram__canvas"
							style={{ transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})` }}
						>
							{/* Edges SVG */}
							<svg
								class="er-diagram__edges"
								width={svgSize().width}
								height={svgSize().height}
							>
								<For each={edges()}>
									{(edge) => (
										<path
											class={`er-diagram__edge${highlightedEdges().has(edge.id) ? ' highlighted' : ''}`}
											d={edgePath(edge)}
										/>
									)}
								</For>
							</svg>

							{/* Table nodes */}
							<For each={nodes()}>
								{(node) => (
									<div
										class={`er-table${highlightedTables().has(node.id) ? ' highlighted' : ''}`}
										style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px` }}
										onClick={(e) => { e.stopPropagation(); handleTableClick(node) }}
										onDblClick={(e) => { e.stopPropagation(); handleTableDblClick(node) }}
									>
										<div class="er-table__header">
											<Icon name="table" size={14} class="er-table__header-icon" />
											{node.name}
										</div>
										<Show when={!compact()}>
											<div class="er-table__columns">
												<For each={node.columns}>
													{(col) => (
														<div class="er-table__column">
															<span class="er-table__column-icon">
																<Show when={col.isPrimaryKey}>
																	<Icon name="key" size={12} class="er-table__column-icon--pk" />
																</Show>
																<Show when={!col.isPrimaryKey && node.fkColumns.has(col.name)}>
																	<Icon name="link" size={12} class="er-table__column-icon--fk" />
																</Show>
															</span>
															<span class="er-table__column-name">{col.name}</span>
															<span class="er-table__column-type">{col.dataType}</span>
														</div>
													)}
												</For>
											</div>
										</Show>
									</div>
								)}
							</For>
						</div>

						{/* Zoom controls */}
						<div class="er-diagram__zoom-controls">
							<button onClick={zoomIn}>+</button>
							<div class="er-diagram__zoom-label">{Math.round(zoom() * 100)}%</div>
							<button onClick={zoomOut}>−</button>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	)
}
