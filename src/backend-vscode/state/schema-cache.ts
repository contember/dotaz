import type { SchemaData } from '@dotaz/shared/types/database'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'

/**
 * Caches schema data per connection/database in the extension host.
 * Used by TreeView and SQL completion provider.
 */
export class SchemaCache {
	// cache[connectionId][databaseName] = SchemaData
	private cache = new Map<string, Map<string, SchemaData>>()
	private connectionManager: ConnectionManager

	constructor(connectionManager: ConnectionManager) {
		this.connectionManager = connectionManager
	}

	get(connectionId: string, database?: string): SchemaData | undefined {
		const dbKey = database ?? '__default__'
		return this.cache.get(connectionId)?.get(dbKey)
	}

	set(connectionId: string, data: SchemaData, database?: string): void {
		const dbKey = database ?? '__default__'
		let dbMap = this.cache.get(connectionId)
		if (!dbMap) {
			dbMap = new Map()
			this.cache.set(connectionId, dbMap)
		}
		dbMap.set(dbKey, data)
	}

	/**
	 * Load schema from the driver and cache it.
	 * Returns the cached schema data.
	 */
	async load(connectionId: string, database?: string): Promise<SchemaData> {
		const driver = this.connectionManager.getDriver(connectionId, database)
		const schema = await driver.loadSchema()
		this.set(connectionId, schema, database)
		return schema
	}

	/**
	 * Load schemas for all active databases of a connection.
	 * Pass defaultDatabase for multi-db connections so the schema
	 * is cached under the actual database name (not just __default__).
	 */
	async loadAll(connectionId: string, activeDatabases?: string[], defaultDatabase?: string): Promise<void> {
		// Load default database — cache under both __default__ and actual name
		const schema = await this.load(connectionId).catch(() => null)
		if (schema && defaultDatabase) {
			this.set(connectionId, schema, defaultDatabase)
		}

		// Load additional active databases
		if (activeDatabases) {
			await Promise.allSettled(
				activeDatabases.map((db) => this.load(connectionId, db)),
			)
		}
	}

	/** Remove all cached data for a connection. */
	invalidate(connectionId: string): void {
		this.cache.delete(connectionId)
	}

	/** Remove cached data for a specific database. */
	invalidateDatabase(connectionId: string, database: string): void {
		this.cache.get(connectionId)?.delete(database)
	}

	/** Clear entire cache. */
	clear(): void {
		this.cache.clear()
	}

	/** Get all connection IDs with cached data. */
	getCachedConnectionIds(): string[] {
		return [...this.cache.keys()]
	}

	/** Get all cached database names for a connection. */
	getCachedDatabases(connectionId: string): string[] {
		const dbMap = this.cache.get(connectionId)
		return dbMap ? [...dbMap.keys()] : []
	}
}
