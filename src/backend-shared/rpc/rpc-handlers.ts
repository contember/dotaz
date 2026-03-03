import type { ConnectionManager } from '../services/connection-manager'
import type { EncryptionService } from '../services/encryption'
import { QueryExecutor } from '../services/query-executor'
import { SessionManager } from '../services/session-manager'
import type { AppDatabase } from '../storage/app-db'
import { BackendAdapter } from './backend-adapter'
import { createHandlers as createSharedHandlers } from './handlers'

export interface HandlerOptions {
	encryption?: EncryptionService
	emitMessage?: (channel: string, payload: unknown) => void
}

function requireAppDb(appDb: AppDatabase | undefined): AppDatabase {
	if (!appDb) throw new Error('AppDatabase is required')
	return appDb
}

export function createHandlers(
	cm: ConnectionManager,
	qe?: QueryExecutor,
	appDb?: AppDatabase,
	Utils?: typeof import('electrobun/bun').Utils,
	opts?: HandlerOptions,
) {
	const db = requireAppDb(appDb)
	const queryExecutor = qe ?? new QueryExecutor(cm, undefined, db)
	const sessionManager = new SessionManager(cm, db)
	const adapter = new BackendAdapter(cm, queryExecutor, db, {
		encryption: opts?.encryption,
		Utils,
		emitMessage: opts?.emitMessage,
		sessionManager,
	})
	return { handlers: createSharedHandlers(adapter), sessionManager, adapter }
}
