import { createHandlers } from '@dotaz/backend-shared/rpc/handlers'
import bookstoreDbUrl from '../../scripts/seed/bookstore.db?url'
import { DemoAdapter } from './demo-adapter'
import { DemoAppState } from './demo-state'
import { WasmSqliteDriver } from './wasm-sqlite-driver'

type EmitMessage = (channel: string, payload: any) => void

/**
 * Bootstrap the browser-only demo mode.
 * Loads WASM SQLite, deserializes the bookstore database,
 * and creates demo RPC handlers.
 */
export async function initDemo(emitMessage: EmitMessage) {
	// 1. Initialize sqlite3 WASM module
	const sqlite3InitModule = (await import('@sqlite.org/sqlite-wasm')).default
	const sqlite3 = await sqlite3InitModule()

	// 2. Fetch the pre-built bookstore database
	const response = await fetch(bookstoreDbUrl)
	const dbBytes = new Uint8Array(await response.arrayBuffer())

	// 3. Create in-memory DB and load the database bytes
	const db = new sqlite3.oo1.DB(':memory:')
	const capi = sqlite3.capi
	const wasm = sqlite3.wasm

	// The seed DB uses WAL journal mode (header bytes 18-19 = 2).
	// WASM VFS cannot open WAL/SHM files, so patch the header to legacy rollback mode
	// before deserializing. See https://www.sqlite.org/fileformat.html (bytes 18-19).
	dbBytes[18] = 1 // write version: legacy
	dbBytes[19] = 1 // read version: legacy

	// Allocate WASM memory for the database bytes
	const nBytes = dbBytes.length
	const pData = wasm.alloc(nBytes)
	wasm.heap8u().set(dbBytes, pData)

	// Deserialize into the :memory: database
	const rc = capi.sqlite3_deserialize(
		db, // sqlite3* (accepts Database)
		'main', // schema name
		pData, // data pointer
		nBytes, // actual size
		nBytes, // buffer size
		// SQLITE_DESERIALIZE_FREEONCLOSE (1) | SQLITE_DESERIALIZE_RESIZEABLE (2)
		1 | 2,
	)
	if (rc !== 0) {
		throw new Error(`sqlite3_deserialize failed with code ${rc}`)
	}

	// Use in-memory journaling (no file I/O)
	db.exec('PRAGMA journal_mode = MEMORY')
	// Enable foreign keys
	db.exec('PRAGMA foreign_keys = ON')

	// 4. Create driver, state, and adapter
	const baseDriver = new WasmSqliteDriver(db)
	const { LoggingDriver } = await import('@dotaz/backend-shared/db/logging-driver')
	const driver = new LoggingDriver(baseDriver)
	const state = new DemoAppState()
	const adapter = new DemoAdapter(driver, state, emitMessage)

	// 5. Create handlers from shared definition
	const handlers = createHandlers(adapter)

	return { handlers }
}
