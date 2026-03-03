// Map native database errors to domain error types

import { AuthenticationError, ConnectionError, ConstraintError, DatabaseError, QueryError } from '../../shared/types/errors'

/** Map a PostgreSQL error to a domain error. PostgreSQL errors carry a `code` property (SQLSTATE). */
export function mapPostgresError(err: unknown): DatabaseError {
	const message = err instanceof Error ? err.message : String(err)
	const pgCode = (err as any)?.code as string | undefined

	// Connection errors
	if (/ECONNREFUSED|connection refused/i.test(message)) {
		return new ConnectionError('CONNECTION_REFUSED', message, { cause: err })
	}
	if (/timeout|timed out/i.test(message)) {
		return new ConnectionError('CONNECTION_TIMEOUT', message, { cause: err })
	}
	if (/ENOTFOUND|getaddrinfo/i.test(message)) {
		return new ConnectionError('HOST_NOT_FOUND', message, { cause: err })
	}
	if (/too many connections|connection limit/i.test(message)) {
		return new ConnectionError('CONNECTION_LIMIT', message, { cause: err })
	}
	if (/SSL|TLS|certificate/i.test(message)) {
		return new ConnectionError('SSL_ERROR', message, { cause: err })
	}

	// Auth errors (PG SQLSTATE 28xxx)
	if (pgCode?.startsWith('28') || /authentication failed|password authentication/i.test(message)) {
		return new AuthenticationError(message, { cause: err })
	}

	// Database not found (PG SQLSTATE 3D000)
	if (pgCode === '3D000' || /database .* does not exist/i.test(message)) {
		return new ConnectionError('DATABASE_NOT_FOUND', message, { cause: err })
	}

	// Constraint violations (PG SQLSTATE 23xxx)
	if (pgCode === '23505' || /violates unique constraint|duplicate key/i.test(message)) {
		return new ConstraintError('CONSTRAINT_UNIQUE', message, { cause: err })
	}
	if (pgCode === '23503' || /violates foreign key constraint/i.test(message)) {
		return new ConstraintError('CONSTRAINT_FK', message, { cause: err })
	}
	if (pgCode === '23514' || /violates check constraint/i.test(message)) {
		return new ConstraintError('CONSTRAINT_CHECK', message, { cause: err })
	}
	if (pgCode === '23502' || /violates not-null constraint/i.test(message)) {
		return new ConstraintError('CONSTRAINT_NOT_NULL', message, { cause: err })
	}

	// Syntax error (PG SQLSTATE 42601)
	if (pgCode === '42601' || /syntax error/i.test(message)) {
		return new QueryError('QUERY_SYNTAX', message, { cause: err })
	}

	// Undefined table (PG SQLSTATE 42P01)
	if (pgCode === '42P01' || /relation .* does not exist/i.test(message)) {
		return new QueryError('TABLE_NOT_FOUND', message, { cause: err })
	}

	// Undefined column (PG SQLSTATE 42703)
	if (pgCode === '42703' || /column .* does not exist/i.test(message)) {
		return new QueryError('COLUMN_NOT_FOUND', message, { cause: err })
	}

	// Permission denied (PG SQLSTATE 42501)
	if (pgCode === '42501' || /permission denied/i.test(message)) {
		return new DatabaseError('PERMISSION_DENIED', message, { cause: err })
	}

	// Generic query class errors (PG SQLSTATE 42xxx = syntax/access, 22xxx = data exception)
	if (pgCode?.startsWith('42') || pgCode?.startsWith('22')) {
		return new QueryError('QUERY_EXECUTION', message, { cause: err })
	}

	return new DatabaseError('UNKNOWN', message, { cause: err })
}

/** Map a SQLite error to a domain error. SQLite errors use message-based patterns. */
export function mapSqliteError(err: unknown): DatabaseError {
	const message = err instanceof Error ? err.message : String(err)

	// Connection errors
	if (/unable to open database|cannot open/i.test(message)) {
		return new ConnectionError('CONNECTION_REFUSED', message, { cause: err })
	}

	// Constraint violations
	if (/UNIQUE constraint failed/i.test(message)) {
		return new ConstraintError('CONSTRAINT_UNIQUE', message, { cause: err })
	}
	if (/FOREIGN KEY constraint failed/i.test(message)) {
		return new ConstraintError('CONSTRAINT_FK', message, { cause: err })
	}
	if (/CHECK constraint failed/i.test(message)) {
		return new ConstraintError('CONSTRAINT_CHECK', message, { cause: err })
	}
	if (/NOT NULL constraint failed/i.test(message)) {
		return new ConstraintError('CONSTRAINT_NOT_NULL', message, { cause: err })
	}

	// Query errors
	if (/no such table/i.test(message)) {
		return new QueryError('TABLE_NOT_FOUND', message, { cause: err })
	}
	if (/no such column/i.test(message)) {
		return new QueryError('COLUMN_NOT_FOUND', message, { cause: err })
	}
	if (/syntax error|near /i.test(message)) {
		return new QueryError('QUERY_SYNTAX', message, { cause: err })
	}

	// Auth — SQLite doesn't have auth, but encryption extensions may
	if (/authorization denied|not authorized/i.test(message)) {
		return new DatabaseError('PERMISSION_DENIED', message, { cause: err })
	}

	return new DatabaseError('UNKNOWN', message, { cause: err })
}

/** Map a MySQL error to a domain error. MySQL errors carry an `errno` property. */
export function mapMysqlError(err: unknown): DatabaseError {
	const message = err instanceof Error ? err.message : String(err)
	const errno = (err as any)?.errno as number | undefined

	// Connection errors
	if (/ECONNREFUSED|connection refused/i.test(message) || errno === 2003) {
		return new ConnectionError('CONNECTION_REFUSED', message, { cause: err })
	}
	if (/timeout|timed out/i.test(message)) {
		return new ConnectionError('CONNECTION_TIMEOUT', message, { cause: err })
	}
	if (/ENOTFOUND|getaddrinfo/i.test(message)) {
		return new ConnectionError('HOST_NOT_FOUND', message, { cause: err })
	}
	if (/too many connections/i.test(message) || errno === 1040) {
		return new ConnectionError('CONNECTION_LIMIT', message, { cause: err })
	}
	if (/SSL|TLS|certificate/i.test(message)) {
		return new ConnectionError('SSL_ERROR', message, { cause: err })
	}

	// Auth errors (MySQL 1045)
	if (errno === 1045 || /access denied/i.test(message)) {
		return new AuthenticationError(message, { cause: err })
	}

	// Database not found (MySQL 1049)
	if (errno === 1049 || /unknown database/i.test(message)) {
		return new ConnectionError('DATABASE_NOT_FOUND', message, { cause: err })
	}

	// Constraint violations
	if (errno === 1062 || /duplicate entry/i.test(message)) {
		return new ConstraintError('CONSTRAINT_UNIQUE', message, { cause: err })
	}
	if (
		errno === 1451 || errno === 1452 || /foreign key constraint/i.test(message) || /cannot delete or update a parent row/i.test(message)
		|| /cannot add or update a child row/i.test(message)
	) {
		return new ConstraintError('CONSTRAINT_FK', message, { cause: err })
	}
	if (errno === 3819 || /check constraint/i.test(message)) {
		return new ConstraintError('CONSTRAINT_CHECK', message, { cause: err })
	}
	if (errno === 1048 || /cannot be null/i.test(message)) {
		return new ConstraintError('CONSTRAINT_NOT_NULL', message, { cause: err })
	}

	// Query errors
	if (errno === 1064 || /syntax error|you have an error in your sql syntax/i.test(message)) {
		return new QueryError('QUERY_SYNTAX', message, { cause: err })
	}
	if (errno === 1146 || /table .* doesn't exist/i.test(message)) {
		return new QueryError('TABLE_NOT_FOUND', message, { cause: err })
	}
	if (errno === 1054 || /unknown column/i.test(message)) {
		return new QueryError('COLUMN_NOT_FOUND', message, { cause: err })
	}

	// Permission denied (MySQL 1142, 1143)
	if (errno === 1142 || errno === 1143 || /command denied|access denied/i.test(message)) {
		return new DatabaseError('PERMISSION_DENIED', message, { cause: err })
	}

	return new DatabaseError('UNKNOWN', message, { cause: err })
}
