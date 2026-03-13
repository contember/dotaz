import type { DatabaseDriver } from './driver'

/**
 * Run a callback within an ephemeral (auto-created, auto-released) session.
 * Handles reserve → try/fn → cancel → release lifecycle.
 */
export async function withEphemeralSession<T>(
	driver: DatabaseDriver,
	fn: (sessionId: string) => Promise<T>,
): Promise<T> {
	const sessionId = `__ephemeral_${crypto.randomUUID()}`
	await driver.reserveSession(sessionId)
	try {
		return await fn(sessionId)
	} finally {
		try { await driver.cancel(sessionId) } catch { /* best effort */ }
		try { await driver.releaseSession(sessionId) } catch { /* best effort */ }
	}
}
