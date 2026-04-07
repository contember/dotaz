import { stripLiteralsAndComments } from '@dotaz/shared/sql'
import type { SQL } from 'bun'

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
	return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|connection (terminated|ended|closed|lost|reset)|socket.*(closed|hang up|end)|write after end|broken pipe|network/i
		.test(message)
}

/**
 * Safely close a connection.
 * Optionally rolls back, then closes the connection.
 */
export async function safeCloseConnection(
	conn: SQL,
	options?: { rollback?: boolean },
): Promise<void> {
	if (options?.rollback) {
		try {
			await conn.unsafe('ROLLBACK')
		} catch { /* ignore — no tx is fine */ }
	}
	try {
		await conn.close()
	} catch { /* already dead */ }
}
