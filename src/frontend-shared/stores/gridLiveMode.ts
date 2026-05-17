import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { SetStoreFunction } from 'solid-js/store'
import type { GridStoreState, TabGridState } from './grid'

/** Half-life (in ticks) of the highlight intensity decay. */
export const LIVE_HALFLIFE_TICKS = 10

/** Generations beyond this are dropped from the change map (intensity ≈ 0.03). */
const LIVE_MAX_AGE = 50

/** Allowed polling intervals (ms). */
export const LIVE_INTERVALS = [2000, 5000, 10000, 30000] as const
export type LiveIntervalMs = (typeof LIVE_INTERVALS)[number]

export interface LiveModeState {
	intervalMs: LiveIntervalMs
	startedAt: number
}

/**
 * Per-tab live-mode change ledger.
 *
 * Keys are stable row identifiers derived from the row's primary-key columns
 * (see `buildRowKey`). Values are cell-level change ages (in ticks). A row that
 * was newly inserted in the most recent tick has a `__row__` sentinel entry to
 * mark "row is new" — used for green flash on the row background.
 *
 * `tick` is bumped each tick so reactive consumers re-read the map (Solid
 * reacts on the field reference, not deep-map mutations).
 */
export interface LiveChanges {
	cellAges: Map<string, Map<string, number>>
	tick: number
}

export const NEW_ROW_SENTINEL = '__row__'

/**
 * Separator joining composite-PK values into a row key. ASCII unit separator
 * (U+001F) is reserved for record fields and never appears in real text/number
 * data, so PK values can't collide across compositions (e.g. `(1, '2|3')` vs
 * `(1|2, 3)`).
 */
const KEY_SEP = ''

/** Build a stable row key from the row's PK column values. */
export function buildRowKey(
	row: Record<string, unknown>,
	pkColumns: string[],
): string | null {
	if (pkColumns.length === 0) return null
	const parts: string[] = []
	for (const col of pkColumns) {
		const v = row[col]
		if (v == null) return null
		parts.push(String(v))
	}
	return parts.join(KEY_SEP)
}

export function getPkColumns(columns: GridColumnDef[]): string[] {
	return columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
}

/**
 * Exponential decay of highlight intensity.
 *
 * `intensity(0) = 1` and `intensity(LIVE_HALFLIFE_TICKS) = 0.5`.
 * Returns 0 past `LIVE_MAX_AGE` so callers can skip rendering.
 */
export function intensityForAge(age: number): number {
	if (age < 0) return 0
	if (age > LIVE_MAX_AGE) return 0
	return Math.pow(0.5, age / LIVE_HALFLIFE_TICKS)
}

/**
 * Compute the diff between an old and new row set, both keyed by the same PK
 * columns. Cells whose new value differs from old are recorded with `age=0`.
 * Rows present in `newRows` but not in `oldByKey` get the `NEW_ROW_SENTINEL`.
 *
 * Returns null if no diff can be computed (no PK columns).
 */
export function diffByPk(
	oldRows: Record<string, unknown>[],
	newRows: Record<string, unknown>[],
	pkColumns: string[],
	columns: GridColumnDef[],
): Map<string, Map<string, number>> | null {
	if (pkColumns.length === 0) return null

	const oldByKey = new Map<string, Record<string, unknown>>()
	for (const r of oldRows) {
		const k = buildRowKey(r, pkColumns)
		if (k != null) oldByKey.set(k, r)
	}

	const changes = new Map<string, Map<string, number>>()
	for (const r of newRows) {
		const k = buildRowKey(r, pkColumns)
		if (k == null) continue
		const prev = oldByKey.get(k)
		if (!prev) {
			changes.set(k, new Map([[NEW_ROW_SENTINEL, 0]]))
			continue
		}
		const perCell = new Map<string, number>()
		for (const col of columns) {
			if (col.isPrimaryKey) continue
			if (!valuesEqual(prev[col.name], r[col.name])) {
				perCell.set(col.name, 0)
			}
		}
		if (perCell.size > 0) changes.set(k, perCell)
	}
	return changes
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null || b == null) return false
	if (typeof a === 'object' || typeof b === 'object') {
		try {
			return JSON.stringify(a) === JSON.stringify(b)
		} catch {
			return false
		}
	}
	return String(a) === String(b)
}

/**
 * Merge a fresh diff into the existing change ledger, aging every existing
 * entry by one tick first. Entries past `LIVE_MAX_AGE` are dropped.
 *
 * Returns a brand-new Map so Solid sees the reference change.
 */
export function mergeAged(
	prev: Map<string, Map<string, number>> | null,
	fresh: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
	const out = new Map<string, Map<string, number>>()

	if (prev) {
		for (const [rowKey, perCell] of prev) {
			const aged = new Map<string, number>()
			for (const [col, age] of perCell) {
				const next = age + 1
				if (next <= LIVE_MAX_AGE) aged.set(col, next)
			}
			if (aged.size > 0) out.set(rowKey, aged)
		}
	}

	for (const [rowKey, perCell] of fresh) {
		const existing = out.get(rowKey)
		if (!existing) {
			out.set(rowKey, new Map(perCell))
		} else {
			for (const [col, age] of perCell) {
				existing.set(col, age)
			}
		}
	}

	return out
}

export function createGridLiveModeActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	getTab: (tabId: string) => TabGridState | undefined,
	fetchLive: (tabId: string) => Promise<void>,
	canEnable: (tabId: string) => { ok: true } | { ok: false; reason: string },
) {
	const timers = new Map<string, ReturnType<typeof setInterval>>()

	function clearTimer(tabId: string) {
		const id = timers.get(tabId)
		if (id != null) {
			clearInterval(id)
			timers.delete(tabId)
		}
	}

	function enable(tabId: string, intervalMs: LiveIntervalMs) {
		const guard = canEnable(tabId)
		if (!guard.ok) return guard
		clearTimer(tabId)
		setState('tabs', tabId, 'liveMode', { intervalMs, startedAt: Date.now() })
		setState('tabs', tabId, 'liveChanges', { cellAges: new Map(), tick: 0 })
		const id = setInterval(() => {
			void fetchLive(tabId)
		}, intervalMs)
		timers.set(tabId, id)
		return { ok: true as const }
	}

	function disable(tabId: string) {
		clearTimer(tabId)
		const tab = getTab(tabId)
		if (!tab) return
		setState('tabs', tabId, 'liveMode', null)
		setState('tabs', tabId, 'liveChanges', null)
	}

	function isActive(tabId: string): boolean {
		return getTab(tabId)?.liveMode != null
	}

	function setIntervalAction(tabId: string, intervalMs: LiveIntervalMs) {
		const tab = getTab(tabId)
		if (!tab?.liveMode) return
		clearTimer(tabId)
		setState('tabs', tabId, 'liveMode', { intervalMs, startedAt: Date.now() })
		const id = setInterval(() => {
			void fetchLive(tabId)
		}, intervalMs)
		timers.set(tabId, id)
	}

	function disposeTab(tabId: string) {
		clearTimer(tabId)
	}

	return {
		enable,
		disable,
		setInterval: setIntervalAction,
		isActive,
		disposeTab,
	}
}
