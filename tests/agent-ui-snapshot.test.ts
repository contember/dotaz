import { summarizeProposalRun } from '@dotaz/frontend-shared/lib/agent-proposals'
import { buildUiSnapshot } from '@dotaz/frontend-shared/lib/ui-snapshot'
import type { QueryResult } from '@dotaz/shared/types/query'
import type { TabInfo } from '@dotaz/shared/types/tab'
import { describe, expect, test } from 'bun:test'

function result(overrides: Partial<QueryResult> = {}): QueryResult {
	return { columns: [], rows: [], rowCount: 0, durationMs: 1, ...overrides }
}

function tab(overrides: Partial<TabInfo> & { id: string }): TabInfo {
	return { type: 'data-grid', title: 'users', connectionId: 'c1', ...overrides }
}

describe('summarizeProposalRun', () => {
	test('sums affected rows across statements', () => {
		const outcome = summarizeProposalRun([
			result({ affectedRows: 3 }),
			result({ affectedRows: 2 }),
		])
		expect(outcome).toEqual({ status: 'executed', result: { affectedRows: 5, statements: 2 } })
	})

	test('missing affectedRows counts as zero', () => {
		const outcome = summarizeProposalRun([result(), result({ affectedRows: 1 })])
		expect(outcome.status).toBe('executed')
		expect(outcome.result).toEqual({ affectedRows: 1, statements: 2 })
	})

	test('a per-statement error fails the whole proposal', () => {
		const outcome = summarizeProposalRun([
			result({ affectedRows: 1 }),
			result({ error: 'syntax error at or near ")"' }),
		])
		expect(outcome.status).toBe('failed')
		expect(outcome.error).toBe('syntax error at or near ")"')
		expect(outcome.result).toEqual({ affectedRows: 1, statements: 2 })
	})

	test('no results is an executed no-op', () => {
		expect(summarizeProposalRun([])).toEqual({ status: 'executed', result: { affectedRows: 0, statements: 0 } })
	})
})

describe('buildUiSnapshot', () => {
	const tabs: TabInfo[] = [
		tab({ id: 't1', schema: 'public', table: 'users', database: 'app' }),
		tab({ id: 't2', type: 'sql-console', title: 'SQL — app', database: 'app' }),
		tab({ id: 't3', type: 'sql-console', title: 'SQL — empty' }),
	]

	const snapshot = buildUiSnapshot({
		tabs,
		activeTabId: 't2',
		activeConnectionId: 'c1',
		getSql: (tabId) => (tabId === 't2' ? 'select 1' : ''),
		now: 1717430000000,
	})

	test('maps table coordinates for grid tabs', () => {
		expect(snapshot.tabs[0]).toEqual({
			id: 't1',
			type: 'data-grid',
			title: 'users',
			connectionId: 'c1',
			database: 'app',
			schema: 'public',
			table: 'users',
		})
	})

	test('includes editor contents for console tabs only', () => {
		expect(snapshot.tabs[1].sql).toBe('select 1')
		expect(snapshot.tabs[0].sql).toBeUndefined()
		// Empty editors stay out of the payload rather than shipping empty strings.
		expect(snapshot.tabs[2].sql).toBeUndefined()
	})

	test('carries the active tab, connection and timestamp', () => {
		expect(snapshot.activeTabId).toBe('t2')
		expect(snapshot.activeConnectionId).toBe('c1')
		expect(snapshot.updatedAt).toBe(1717430000000)
	})

	test('no open tabs yields an empty snapshot', () => {
		const empty = buildUiSnapshot({
			tabs: [],
			activeTabId: null,
			activeConnectionId: null,
			getSql: () => undefined,
			now: 1,
		})
		expect(empty).toEqual({ tabs: [], activeTabId: null, activeConnectionId: null, updatedAt: 1 })
	})
})
