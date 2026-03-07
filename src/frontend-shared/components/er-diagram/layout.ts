/**
 * Simple layered graph layout for ER diagrams.
 * Replaces elkjs (~1.6 MB) with a lightweight implementation.
 *
 * Algorithm:
 * 1. Assign layers via longest-path layering (respects FK direction)
 * 2. Order nodes within layers to reduce edge crossings (barycenter heuristic)
 * 3. Compute x/y positions
 * 4. Route edges with orthogonal (Manhattan) paths
 */

interface LayoutNode {
	id: string
	width: number
	height: number
}

interface LayoutEdge {
	id: string
	source: string
	target: string
}

interface PositionedNode {
	id: string
	x: number
	y: number
	width: number
	height: number
}

interface EdgeSection {
	startPoint: { x: number; y: number }
	endPoint: { x: number; y: number }
	bendPoints: Array<{ x: number; y: number }>
}

interface PositionedEdge {
	id: string
	sections: EdgeSection[]
}

interface LayoutResult {
	nodes: PositionedNode[]
	edges: PositionedEdge[]
}

const NODE_SPACING = 40
const LAYER_SPACING = 60

export function computeGraphLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
): LayoutResult {
	if (nodes.length === 0) return { nodes: [], edges: [] }

	const nodeMap = new Map(nodes.map((n) => [n.id, n]))

	// Build adjacency
	const outgoing = new Map<string, string[]>()
	const incoming = new Map<string, string[]>()
	for (const n of nodes) {
		outgoing.set(n.id, [])
		incoming.set(n.id, [])
	}
	for (const e of edges) {
		if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
			outgoing.get(e.source)!.push(e.target)
			incoming.get(e.target)!.push(e.source)
		}
	}

	// 1. Layer assignment — longest path from sources
	const layers = assignLayers(nodes, outgoing, incoming)

	// 2. Order nodes within layers to reduce crossings
	orderLayers(layers, outgoing, incoming)

	// 3. Position nodes
	const positioned = positionNodes(layers, nodeMap)

	// 4. Route edges
	const posMap = new Map(positioned.map((n) => [n.id, n]))
	const routedEdges = edges
		.filter((e) => posMap.has(e.source) && posMap.has(e.target))
		.map((e) => routeEdge(e, posMap))

	return { nodes: positioned, edges: routedEdges }
}

function assignLayers(
	nodes: LayoutNode[],
	outgoing: Map<string, string[]>,
	incoming: Map<string, string[]>,
): string[][] {
	const layer = new Map<string, number>()

	// Topological sort (Kahn's algorithm), handling cycles gracefully
	const inDegree = new Map<string, number>()
	for (const n of nodes) {
		inDegree.set(n.id, incoming.get(n.id)!.length)
	}

	const queue: string[] = []
	for (const n of nodes) {
		if (inDegree.get(n.id)! === 0) queue.push(n.id)
	}

	// If no roots (all cycles), start from node with fewest incoming
	if (queue.length === 0) {
		let minId = nodes[0].id
		let minDeg = Infinity
		for (const n of nodes) {
			const deg = incoming.get(n.id)!.length
			if (deg < minDeg) {
				minDeg = deg
				minId = n.id
			}
		}
		queue.push(minId)
		inDegree.set(minId, 0)
	}

	const visited = new Set<string>()
	while (queue.length > 0) {
		const id = queue.shift()!
		if (visited.has(id)) continue
		visited.add(id)

		// Layer = max(layer of predecessors) + 1, or 0 if no predecessors
		let maxPredLayer = -1
		for (const pred of incoming.get(id)!) {
			if (layer.has(pred)) {
				maxPredLayer = Math.max(maxPredLayer, layer.get(pred)!)
			}
		}
		layer.set(id, maxPredLayer + 1)

		for (const succ of outgoing.get(id)!) {
			const newDeg = inDegree.get(succ)! - 1
			inDegree.set(succ, newDeg)
			if (newDeg <= 0 && !visited.has(succ)) {
				queue.push(succ)
			}
		}
	}

	// Handle any remaining unvisited nodes (cycles)
	for (const n of nodes) {
		if (!visited.has(n.id)) {
			layer.set(n.id, 0)
		}
	}

	// Group by layer
	const maxLayer = Math.max(...layer.values(), 0)
	const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
	for (const n of nodes) {
		layers[layer.get(n.id)!].push(n.id)
	}

	return layers.filter((l) => l.length > 0)
}

function orderLayers(
	layers: string[][],
	outgoing: Map<string, string[]>,
	incoming: Map<string, string[]>,
): void {
	// Barycenter heuristic — iterate a few times
	const posInLayer = new Map<string, number>()

	// Initialize positions
	for (const layer of layers) {
		for (let i = 0; i < layer.length; i++) {
			posInLayer.set(layer[i], i)
		}
	}

	for (let iter = 0; iter < 4; iter++) {
		// Forward pass
		for (let li = 1; li < layers.length; li++) {
			sortLayerByBarycenter(layers[li], incoming, posInLayer)
			for (let i = 0; i < layers[li].length; i++) {
				posInLayer.set(layers[li][i], i)
			}
		}
		// Backward pass
		for (let li = layers.length - 2; li >= 0; li--) {
			sortLayerByBarycenter(layers[li], outgoing, posInLayer)
			for (let i = 0; i < layers[li].length; i++) {
				posInLayer.set(layers[li][i], i)
			}
		}
	}
}

function sortLayerByBarycenter(
	layer: string[],
	neighbors: Map<string, string[]>,
	posInLayer: Map<string, number>,
): void {
	const barycenters = new Map<string, number>()
	for (const id of layer) {
		const nbrs = neighbors.get(id) ?? []
		const positions = nbrs.map((n) => posInLayer.get(n) ?? 0)
		barycenters.set(
			id,
			positions.length > 0
				? positions.reduce((a, b) => a + b, 0) / positions.length
				: posInLayer.get(id) ?? 0,
		)
	}
	layer.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!)
}

function positionNodes(
	layers: string[][],
	nodeMap: Map<string, LayoutNode>,
): PositionedNode[] {
	const result: PositionedNode[] = []
	let x = 0

	for (const layer of layers) {
		let maxWidth = 0
		let y = 0

		for (const id of layer) {
			const node = nodeMap.get(id)!
			result.push({
				id,
				x,
				y,
				width: node.width,
				height: node.height,
			})
			maxWidth = Math.max(maxWidth, node.width)
			y += node.height + NODE_SPACING
		}

		x += maxWidth + LAYER_SPACING
	}

	// Center layers vertically relative to the tallest one
	const layerHeights: number[] = []
	let layerStart = 0
	let maxTotalHeight = 0

	for (const layer of layers) {
		let totalHeight = 0
		for (const id of layer) {
			const node = nodeMap.get(id)!
			totalHeight += node.height
		}
		totalHeight += (layer.length - 1) * NODE_SPACING
		layerHeights.push(totalHeight)
		if (totalHeight > maxTotalHeight) maxTotalHeight = totalHeight

		layerStart += layer.length
	}

	let idx = 0
	for (let li = 0; li < layers.length; li++) {
		const offset = (maxTotalHeight - layerHeights[li]) / 2
		for (let ni = 0; ni < layers[li].length; ni++) {
			result[idx].y += offset
			idx++
		}
	}

	return result
}

function routeEdge(
	edge: LayoutEdge,
	posMap: Map<string, PositionedNode>,
): PositionedEdge {
	const src = posMap.get(edge.source)!
	const tgt = posMap.get(edge.target)!

	// Start from right side of source, end at left side of target
	const startX = src.x + src.width
	const startY = src.y + src.height / 2
	const endX = tgt.x
	const endY = tgt.y + tgt.height / 2

	const bendPoints: Array<{ x: number; y: number }> = []

	if (startX < endX) {
		// Normal left-to-right: single midpoint bend
		const midX = (startX + endX) / 2
		bendPoints.push({ x: midX, y: startY })
		bendPoints.push({ x: midX, y: endY })
	} else {
		// Backward edge: route around
		const offsetX = LAYER_SPACING / 2
		const offsetY = Math.max(src.height, tgt.height) / 2 + NODE_SPACING
		const goY = Math.min(src.y, tgt.y) - offsetY
		bendPoints.push({ x: startX + offsetX, y: startY })
		bendPoints.push({ x: startX + offsetX, y: goY })
		bendPoints.push({ x: endX - offsetX, y: goY })
		bendPoints.push({ x: endX - offsetX, y: endY })
	}

	return {
		id: edge.id,
		sections: [
			{
				startPoint: { x: startX, y: startY },
				endPoint: { x: endX, y: endY },
				bendPoints,
			},
		],
	}
}
