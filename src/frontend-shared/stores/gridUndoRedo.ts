import type { SetStoreFunction } from 'solid-js/store'
import { replaceRecordContents } from '../lib/store-records'
import type { GridStoreState, PendingChanges, TabGridState } from './grid'

const MAX_UNDO_STACK = 50

export interface UndoSnapshot {
	rows: Record<string, unknown>[]
	pendingChanges: PendingChanges
}

/** Guard flag to prevent nested snapshots during compound operations. */
let snapshotGuard = false

function clonePendingChanges(pc: PendingChanges): PendingChanges {
	return {
		cellEdits: { ...pc.cellEdits },
		newRows: new Set(pc.newRows),
		deletedRows: new Set(pc.deletedRows),
	}
}

function captureSnapshot(tab: TabGridState): UndoSnapshot {
	return {
		rows: tab.rows.map((r) => ({ ...r })),
		pendingChanges: clonePendingChanges(tab.pendingChanges),
	}
}

function restorePendingChanges(
	setState: SetStoreFunction<GridStoreState>,
	tabId: string,
	pendingChanges: PendingChanges,
) {
	setState(
		'tabs',
		tabId,
		'pendingChanges',
		'cellEdits',
		(edits) => replaceRecordContents(edits, pendingChanges.cellEdits),
	)
	setState('tabs', tabId, 'pendingChanges', 'newRows', pendingChanges.newRows)
	setState('tabs', tabId, 'pendingChanges', 'deletedRows', pendingChanges.deletedRows)
}

export function createGridUndoRedoActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	_ensureTab: (tabId: string) => TabGridState,
	getTab: (tabId: string) => TabGridState | undefined,
) {
	function pushSnapshot(tabId: string) {
		if (snapshotGuard) return
		const tab = getTab(tabId)
		if (!tab) return

		const snapshot = captureSnapshot(tab)
		const undoStack = [...tab.undoStack]
		undoStack.push(snapshot)
		if (undoStack.length > MAX_UNDO_STACK) {
			undoStack.shift()
		}
		setState('tabs', tabId, 'undoStack', undoStack)
		setState('tabs', tabId, 'redoStack', [])
	}

	function restoreSnapshot(tabId: string, snapshot: UndoSnapshot) {
		const tab = getTab(tabId)
		setState('tabs', tabId, 'rows', snapshot.rows.map((r) => ({ ...r })))
		if (tab) restorePendingChanges(setState, tabId, clonePendingChanges(snapshot.pendingChanges))
		setState('tabs', tabId, 'editingCell', null)
	}

	function undo(tabId: string) {
		const tab = getTab(tabId)
		if (!tab || tab.undoStack.length === 0) return

		const undoStack = [...tab.undoStack]
		const snapshot = undoStack.pop()!
		const currentSnapshot = captureSnapshot(tab)
		const redoStack = [...tab.redoStack, currentSnapshot]

		setState('tabs', tabId, 'undoStack', undoStack)
		setState('tabs', tabId, 'redoStack', redoStack)
		restoreSnapshot(tabId, snapshot)
	}

	function redo(tabId: string) {
		const tab = getTab(tabId)
		if (!tab || tab.redoStack.length === 0) return

		const redoStack = [...tab.redoStack]
		const snapshot = redoStack.pop()!
		const currentSnapshot = captureSnapshot(tab)
		const undoStack = [...tab.undoStack, currentSnapshot]

		setState('tabs', tabId, 'undoStack', undoStack)
		setState('tabs', tabId, 'redoStack', redoStack)
		restoreSnapshot(tabId, snapshot)
	}

	function clearHistory(tabId: string) {
		const tab = getTab(tabId)
		if (!tab) return
		setState('tabs', tabId, 'undoStack', [])
		setState('tabs', tabId, 'redoStack', [])
	}

	function canUndo(tabId: string): boolean {
		const tab = getTab(tabId)
		return !!tab && tab.undoStack.length > 0
	}

	function canRedo(tabId: string): boolean {
		const tab = getTab(tabId)
		return !!tab && tab.redoStack.length > 0
	}

	function withUndoGroup<T>(tabId: string, fn: () => T): T {
		if (snapshotGuard) {
			// Already inside a group, just run
			return fn()
		}
		pushSnapshot(tabId)
		snapshotGuard = true
		try {
			return fn()
		} finally {
			snapshotGuard = false
		}
	}

	return {
		pushSnapshot,
		undo,
		redo,
		clearHistory,
		canUndo,
		canRedo,
		withUndoGroup,
	}
}
