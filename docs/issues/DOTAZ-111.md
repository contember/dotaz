# DOTAZ-111: SessionManager service

**Phase**: 15 — Session Management
**Type**: backend
**Dependencies**: DOTAZ-109

## Description

Create a `SessionManager` service that manages the lifecycle of pinned sessions. A pinned session is a reserved database connection that persists across multiple query executions, allowing users to maintain session-level state (SET variables, temp tables, transactions).

The SessionManager does NOT track tab bindings — that's a frontend concern.

### SessionManager API

```typescript
export interface SessionInfo {
	sessionId: string
	connectionId: string
	database?: string
	label: string // auto-generated: "Session 1", "Session 2"
	inTransaction: boolean
	createdAt: number
}

export class SessionManager {
	createSession(connectionId: string, database?: string): Promise<SessionInfo>
	destroySession(sessionId: string): Promise<void>
	listSessions(connectionId: string): SessionInfo[]
	getSession(sessionId: string): SessionInfo | undefined
	handleConnectionLost(connectionId: string): void
}
```

- `createSession()` — validates max sessions limit, calls `driver.reserveSession()`, stores metadata
- `destroySession()` — calls `driver.releaseSession()` (which handles tx rollback), removes metadata
- `listSessions()` — returns all sessions for a connection, refreshes `inTransaction` state from driver
- `handleConnectionLost()` — cleans up all sessions for a connection (no driver calls — connection is already gone)

### TransactionManager — sessionId threading

Add optional `sessionId` to all `TransactionManager` methods (after existing `database` parameter):

```typescript
async begin(connectionId: string, database?: string, sessionId?: string): Promise<void>
async commit(connectionId: string, database?: string, sessionId?: string): Promise<void>
async rollback(connectionId: string, database?: string, sessionId?: string): Promise<void>
isActive(connectionId: string, database?: string, sessionId?: string): boolean
rollbackIfActive(connectionId: string, database?: string, sessionId?: string): Promise<void>
```

### Settings defaults

Add to `DEFAULT_SETTINGS` in `app-db.ts`:

```typescript
defaultConnectionMode: "pool",        // "pool" | "pinned-per-tab" | "single-session"
autoPin: "on-begin",                  // "on-begin" | "on-set-session" | "never"
autoUnpin: "never",                   // "on-commit" | "never"
maxSessionsPerConnection: "5",
```

## Files

- `src/backend-shared/services/session-manager.ts` — new file
- `src/backend-shared/services/transaction-manager.ts` — add sessionId param
- `src/backend-shared/storage/app-db.ts` — add settings defaults
- `tests/session-manager.test.ts` — new test file

## Acceptance Criteria

- [ ] SessionManager creates sessions via driver.reserveSession()
- [ ] SessionManager destroys sessions via driver.releaseSession()
- [ ] Max sessions per connection enforced (rejects with error)
- [ ] handleConnectionLost() cleans up all sessions for a connection
- [ ] listSessions() returns current session state including inTransaction
- [ ] TransactionManager methods accept optional sessionId and pass to driver
- [ ] Settings defaults added to DEFAULT_SETTINGS
- [ ] Tests: create/destroy lifecycle, max sessions enforcement, connection loss cleanup
