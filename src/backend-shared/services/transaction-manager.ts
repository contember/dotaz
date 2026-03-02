import type { ConnectionManager } from "./connection-manager";

/**
 * Manages transactions per-connection.
 * Wraps driver-level transaction methods with validation and state tracking.
 */
export class TransactionManager {
	private cm: ConnectionManager;

	constructor(cm: ConnectionManager) {
		this.cm = cm;
	}

	async begin(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		const driver = this.cm.getDriver(connectionId, database);
		if (driver.inTransaction(sessionId)) {
			throw new Error("Transaction already active on this connection");
		}
		await driver.beginTransaction(sessionId);
	}

	async commit(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		const driver = this.cm.getDriver(connectionId, database);
		if (!driver.inTransaction(sessionId)) {
			throw new Error("No active transaction to commit");
		}
		await driver.commit(sessionId);
	}

	async rollback(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		const driver = this.cm.getDriver(connectionId, database);
		if (!driver.inTransaction(sessionId)) {
			throw new Error("No active transaction to rollback");
		}
		await driver.rollback(sessionId);
	}

	isActive(connectionId: string, database?: string, sessionId?: string): boolean {
		try {
			const driver = this.cm.getDriver(connectionId, database);
			return driver.inTransaction(sessionId);
		} catch {
			return false;
		}
	}

	/** Rollback any active transaction on this connection (e.g. before disconnect). */
	async rollbackIfActive(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		if (this.isActive(connectionId, database, sessionId)) {
			await this.rollback(connectionId, database, sessionId);
		}
	}
}
