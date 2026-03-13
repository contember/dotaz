import { stripLiteralsAndComments } from '@dotaz/shared/sql'
import type { ReservedSQL } from 'bun'

/** Minimal interface for transaction state tracking. */
interface TxTrackable {
	txActive: boolean
	txAborted?: boolean
}

/** Detect raw transaction-control statements and sync txActive/txAborted flags. */
export function syncTxActive(session: TxTrackable, sql: string): void {
	const upper = stripLiteralsAndComments(sql).trim().toUpperCase()
	if (/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)) {
		session.txActive = true
		if ('txAborted' in session) session.txAborted = false
	} else if (/^(COMMIT|END)\b/.test(upper)) {
		session.txActive = false
		if ('txAborted' in session) session.txAborted = false
	} else if (/^ROLLBACK\b/.test(upper) && !/^ROLLBACK\s+TO\b/.test(upper)) {
		session.txActive = false
		if ('txAborted' in session) session.txAborted = false
	}
}

/** Detect connection-level errors (TCP drop, reset, etc.) as opposed to protocol errors. */
export function isConnectionLevelError(err: unknown): boolean {
	const code = (err as any)?.code
	if (typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTCONN)$/.test(code)) {
		return true
	}
	// fallback for errors without .code (Bun-specific, string messages, etc.)
	const message = err instanceof Error ? err.message : String(err)
	return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|connection (terminated|ended|closed|lost|reset)|socket.*(closed|hang up|end)|write after end|broken pipe|network/i.test(message)
}

/**
 * Safely release a reserved connection back to the pool.
 * Optionally rolls back, then runs the reset function (e.g. DISCARD ALL or RESET CONNECTION),
 * releases the connection, or closes it if reset/release fails.
 */
export async function safeReleaseConnection(
	conn: ReservedSQL,
	resetFn: (conn: ReservedSQL) => Promise<void>,
	options?: { rollback?: boolean },
): Promise<void> {
	if (options?.rollback) {
		try { await conn.unsafe('ROLLBACK') } catch { /* ignore — no tx is fine */ }
	}
	try {
		await resetFn(conn)
		try { conn.release() } catch { /* broken connection */ }
	} catch {
		try { conn.close({ timeout: 0 }) } catch { /* already dead */ }
	}
}
