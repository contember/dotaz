// Connection configuration and state types

export type ConnectionType = "postgresql" | "sqlite" | "mysql";

export interface PostgresConnectionConfig {
	type: "postgresql";
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: boolean;
	activeDatabases?: string[];
}

export interface SqliteConnectionConfig {
	type: "sqlite";
	path: string;
}

export interface MysqlConnectionConfig {
	type: "mysql";
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: boolean;
}

export type ConnectionConfig = PostgresConnectionConfig | SqliteConnectionConfig | MysqlConnectionConfig;

// ── Metadata registry ──

export interface ConnectionTypeMeta {
	label: string;
	hasPassword: boolean;
	hasHost: boolean;
	defaultPort?: number;
	supportsMultiDatabase: boolean;
}

export const CONNECTION_TYPE_META: Record<ConnectionType, ConnectionTypeMeta> = {
	postgresql: { label: "PostgreSQL", hasPassword: true, hasHost: true, defaultPort: 5432, supportsMultiDatabase: true },
	sqlite:     { label: "SQLite",     hasPassword: false, hasHost: false, supportsMultiDatabase: false },
	mysql:      { label: "MySQL",      hasPassword: true, hasHost: true, defaultPort: 3306, supportsMultiDatabase: false },
};

// ── Utility functions ──

export function getDefaultDatabase(config: ConnectionConfig): string {
	switch (config.type) {
		case "postgresql": return config.database;
		case "sqlite": return config.path;
		case "mysql": return config.database;
	}
}

export function isServerConfig(config: ConnectionConfig): config is PostgresConnectionConfig | MysqlConnectionConfig {
	return CONNECTION_TYPE_META[config.type].hasHost;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface ConnectionInfo {
	id: string;
	name: string;
	config: ConnectionConfig;
	state: ConnectionState;
	error?: string;
	createdAt: string;
	updatedAt: string;
}
