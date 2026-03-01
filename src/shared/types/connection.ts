// Connection configuration and state types

export type ConnectionType = "postgresql" | "sqlite";

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

export type ConnectionConfig = PostgresConnectionConfig | SqliteConnectionConfig;

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
