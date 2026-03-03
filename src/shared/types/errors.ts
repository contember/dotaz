// Domain error types for Dotaz — used across backend and frontend

/** Error codes for domain-specific error classification */
export type DatabaseErrorCode =
	| 'CONNECTION_REFUSED'
	| 'CONNECTION_TIMEOUT'
	| 'HOST_NOT_FOUND'
	| 'CONNECTION_LIMIT'
	| 'SSL_ERROR'
	| 'AUTH_FAILED'
	| 'DATABASE_NOT_FOUND'
	| 'QUERY_SYNTAX'
	| 'QUERY_EXECUTION'
	| 'TABLE_NOT_FOUND'
	| 'COLUMN_NOT_FOUND'
	| 'CONSTRAINT_UNIQUE'
	| 'CONSTRAINT_FK'
	| 'CONSTRAINT_CHECK'
	| 'CONSTRAINT_NOT_NULL'
	| 'PERMISSION_DENIED'
	| 'UNKNOWN'

/** Base domain error with a typed code for programmatic handling */
export class DatabaseError extends Error {
	readonly code: DatabaseErrorCode

	constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'DatabaseError'
		this.code = code
	}
}

/** Connection-related errors (refused, timeout, host not found, SSL, limits) */
export class ConnectionError extends DatabaseError {
	constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options)
		this.name = 'ConnectionError'
	}
}

/** Authentication errors (invalid credentials) */
export class AuthenticationError extends DatabaseError {
	constructor(message: string, options?: ErrorOptions) {
		super('AUTH_FAILED', message, options)
		this.name = 'AuthenticationError'
	}
}

/** Query-related errors (syntax errors, execution failures) */
export class QueryError extends DatabaseError {
	constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options)
		this.name = 'QueryError'
	}
}

/** Constraint violation errors (unique, FK, check, not-null) */
export class ConstraintError extends DatabaseError {
	constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options)
		this.name = 'ConstraintError'
	}
}

/** Serialized error shape for RPC transport (JSON-safe) */
export interface SerializedError {
	code: DatabaseErrorCode
	message: string
}

/** Serialize a DatabaseError (or any error) to a JSON-safe object */
export function serializeError(err: unknown): SerializedError {
	if (err instanceof DatabaseError) {
		return { code: err.code, message: err.message }
	}
	const message = err instanceof Error ? err.message : String(err)
	return { code: 'UNKNOWN', message }
}

/** Map a DatabaseErrorCode to a user-friendly message, falling back to the raw message */
export function friendlyMessageForCode(code: DatabaseErrorCode, rawMessage: string): string {
	switch (code) {
		case 'CONNECTION_REFUSED':
			return 'Connection refused \u2014 is the database server running?'
		case 'CONNECTION_TIMEOUT':
			return 'Connection timed out \u2014 check host and port'
		case 'HOST_NOT_FOUND':
			return 'Host not found \u2014 check the hostname'
		case 'CONNECTION_LIMIT':
			return 'Too many connections \u2014 try again later'
		case 'SSL_ERROR':
			return 'SSL/TLS error \u2014 check your SSL configuration'
		case 'AUTH_FAILED':
			return 'Authentication failed \u2014 check username and password'
		case 'DATABASE_NOT_FOUND':
			return 'Database not found \u2014 check the database name'
		case 'PERMISSION_DENIED':
			return 'Permission denied \u2014 insufficient privileges'
		// For query/constraint errors, the raw message is more useful to developers
		case 'QUERY_SYNTAX':
		case 'QUERY_EXECUTION':
		case 'TABLE_NOT_FOUND':
		case 'COLUMN_NOT_FOUND':
		case 'CONSTRAINT_UNIQUE':
		case 'CONSTRAINT_FK':
		case 'CONSTRAINT_CHECK':
		case 'CONSTRAINT_NOT_NULL':
			return rawMessage
		case 'UNKNOWN':
			return rawMessage || 'An unexpected error occurred'
	}
}
