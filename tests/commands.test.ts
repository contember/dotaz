import { commandRegistry } from '@dotaz/frontend-shared/lib/commands'
import type { Command } from '@dotaz/frontend-shared/lib/commands'
import { beforeEach, describe, expect, test } from 'bun:test'

function makeCommand(overrides: Partial<Command> & { id: string; label: string }): Command {
	return {
		category: 'Navigation',
		handler: () => {},
		...overrides,
	}
}

describe('commandRegistry', () => {
	beforeEach(() => {
		// Clear all registered commands between tests
		for (const cmd of commandRegistry.getAll()) {
			commandRegistry.unregister(cmd.id)
		}
	})

	test('register and retrieve commands', () => {
		commandRegistry.register(makeCommand({ id: 'test-1', label: 'Test One' }))
		commandRegistry.register(makeCommand({ id: 'test-2', label: 'Test Two' }))

		expect(commandRegistry.getAll()).toHaveLength(2)
		expect(commandRegistry.getById('test-1')?.label).toBe('Test One')
		expect(commandRegistry.getById('test-2')?.label).toBe('Test Two')
	})

	test('unregister removes a command', () => {
		commandRegistry.register(makeCommand({ id: 'rm-me', label: 'Remove Me' }))
		expect(commandRegistry.getAll()).toHaveLength(1)

		commandRegistry.unregister('rm-me')
		expect(commandRegistry.getAll()).toHaveLength(0)
		expect(commandRegistry.getById('rm-me')).toBeUndefined()
	})

	test('search returns all commands when query is empty', () => {
		commandRegistry.register(makeCommand({ id: 'a', label: 'Alpha' }))
		commandRegistry.register(makeCommand({ id: 'b', label: 'Beta' }))

		const results = commandRegistry.search('')
		expect(results).toHaveLength(2)
	})

	test('search filters with fuzzy matching', () => {
		commandRegistry.register(makeCommand({ id: 'nsc', label: 'New SQL Console' }))
		commandRegistry.register(makeCommand({ id: 'ct', label: 'Close Tab' }))
		commandRegistry.register(makeCommand({ id: 'cat', label: 'Close All Tabs' }))

		// "sql" matches "New SQL Console"
		expect(commandRegistry.search('sql').map((c) => c.id)).toEqual(['nsc'])

		// "ct" matches "Close Tab" and "Close All Tabs" (fuzzy: c...t)
		const ctResults = commandRegistry.search('ct')
		expect(ctResults.length).toBeGreaterThanOrEqual(2)

		// "xyz" matches nothing
		expect(commandRegistry.search('xyz')).toHaveLength(0)
	})

	test('fuzzy match is case-insensitive', () => {
		commandRegistry.register(makeCommand({ id: 'fq', label: 'Format SQL' }))

		expect(commandRegistry.search('FORMAT')).toHaveLength(1)
		expect(commandRegistry.search('format')).toHaveLength(1)
		expect(commandRegistry.search('FoRmAt')).toHaveLength(1)
	})

	test('recently used commands appear first in search', () => {
		commandRegistry.register(makeCommand({ id: 'a', label: 'Alpha' }))
		commandRegistry.register(makeCommand({ id: 'b', label: 'Beta' }))
		commandRegistry.register(makeCommand({ id: 'c', label: 'Charlie' }))

		// Without recent, alphabetical order
		let results = commandRegistry.search('')
		expect(results[0].id).toBe('a')

		// Execute "c" to mark it recent
		commandRegistry.execute('c')

		results = commandRegistry.search('')
		expect(results[0].id).toBe('c')
	})

	test('execute calls the command handler', () => {
		let called = false
		commandRegistry.register(
			makeCommand({
				id: 'exec-test',
				label: 'Execute Test',
				handler: () => {
					called = true
				},
			}),
		)

		commandRegistry.execute('exec-test')
		expect(called).toBe(true)
	})

	test('execute does nothing for unknown command id', () => {
		// Should not throw
		commandRegistry.execute('nonexistent')
	})

	test('recently used preserves order of most recent', () => {
		commandRegistry.register(makeCommand({ id: 'a', label: 'Alpha' }))
		commandRegistry.register(makeCommand({ id: 'b', label: 'Beta' }))
		commandRegistry.register(makeCommand({ id: 'c', label: 'Charlie' }))

		commandRegistry.execute('a')
		commandRegistry.execute('b')
		commandRegistry.execute('c')

		// Most recent first: c, b, a
		const results = commandRegistry.search('')
		expect(results[0].id).toBe('c')
		expect(results[1].id).toBe('b')
		expect(results[2].id).toBe('a')
	})
})
