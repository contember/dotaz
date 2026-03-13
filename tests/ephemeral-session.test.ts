import { describe, expect, it } from 'bun:test'
import { withEphemeralSession } from '../src/backend-shared/db/ephemeral-session'
import type { DatabaseDriver } from '../src/backend-shared/db/driver'

function createMockDriver(): DatabaseDriver & { calls: string[] } {
	const calls: string[] = []
	return {
		calls,
		reserveSession: async (id: string) => { calls.push(`reserve:${id}`) },
		releaseSession: async (id: string) => { calls.push(`release:${id}`) },
		cancel: async (id?: string) => { calls.push(`cancel:${id}`) },
	} as unknown as DatabaseDriver & { calls: string[] }
}

describe('withEphemeralSession', () => {
	it('reserves, calls fn, then cancels and releases', async () => {
		const driver = createMockDriver()
		const result = await withEphemeralSession(driver, async (sessionId) => {
			expect(sessionId).toStartWith('__ephemeral_')
			driver.calls.push(`fn:${sessionId}`)
			return 42
		})

		expect(result).toBe(42)
		expect(driver.calls.length).toBe(4)
		expect(driver.calls[0]).toStartWith('reserve:__ephemeral_')
		expect(driver.calls[1]).toStartWith('fn:__ephemeral_')
		expect(driver.calls[2]).toStartWith('cancel:__ephemeral_')
		expect(driver.calls[3]).toStartWith('release:__ephemeral_')
	})

	it('cleans up on error and rethrows', async () => {
		const driver = createMockDriver()
		const error = new Error('test error')

		await expect(
			withEphemeralSession(driver, async () => { throw error }),
		).rejects.toThrow('test error')

		expect(driver.calls.length).toBe(3)
		expect(driver.calls[0]).toStartWith('reserve:')
		expect(driver.calls[1]).toStartWith('cancel:')
		expect(driver.calls[2]).toStartWith('release:')
	})

	it('still releases even if cancel throws', async () => {
		const calls: string[] = []
		const driver = {
			calls,
			reserveSession: async (id: string) => { calls.push(`reserve:${id}`) },
			releaseSession: async (id: string) => { calls.push(`release:${id}`) },
			cancel: async () => { throw new Error('cancel failed') },
		} as unknown as DatabaseDriver

		const result = await withEphemeralSession(driver, async () => 'ok')
		expect(result).toBe('ok')
		expect(calls[0]).toStartWith('reserve:')
		expect(calls[1]).toStartWith('release:')
	})

	it('generates unique session IDs', async () => {
		const driver = createMockDriver()
		const ids: string[] = []

		await withEphemeralSession(driver, async (id) => { ids.push(id) })
		await withEphemeralSession(driver, async (id) => { ids.push(id) })

		expect(ids[0]).not.toBe(ids[1])
	})
})
