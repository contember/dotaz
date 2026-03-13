# Issue Status

Stav implementace issues z `docs/issues/`. Řazeno podle priority (riziko × effort).

## Bugy

| ID | Závažnost | Popis | Status | Commit |
|---|---|---|---|---|
| DML-1 | critical | Timeout na DML → tichá dvojí exekuce | done | 5b1a030 |
| POOL-1 | high | Raw BEGIN na poolu → pool poisoning | done | eafe6c5 |
| TXSYNC-1 | high | Raw COMMIT failure → desync txActive | done | 80be35b, eb48da8, 0cd706e |
| IDLE-1 | high | Idle rollback na busy connection | done | d50701c, d0c1966, d6ae436 |
| DEFSESS-1 | high | DEFAULT_SESSION hijackuje bezesessionové operace | done | 7126de3 |
| SESS-1 | high | Health check obchází SessionManager při uvolnění | done | 23cd047 |
| HC-1 | high | Health check ping na busy session connection | done | 93b1a1c |
| HC-2 | medium | Concurrent health check bez re-entrancy guardu | done | 5da3633 |
| HC-3 | medium | Vyčerpání poolu blokuje health check | done | 467e2b6 |
| CANCEL-1 | medium | Pool cancel zruší všechny queries, ne jen jednu | done | 19cae3d |
| MYSQL-1 | medium | MySQL reset fallback tiše spolkne chyby | done | 536e9d4, 1b00461, e6ab952 |
| BATCH-1 | medium | COMMIT_UNCERTAIN v executeStatements (UI problém) | pending | |
| TXSYNC-3 | medium | PostgreSQL 25P02 aborted tx není trackován | pending | |
| DEFSESS-2 | low | disconnect() podmíněný ROLLBACK | pending | |
| TXSYNC-2 | low | syncTxActive edge cases (PL/pgSQL, komentáře) | pending | |
| MINOR-1 | cosmetic | Double ROLLBACK, špatný sessionId v logu | pending | |

## Návrhy na zlepšení

| ID | Popis | Status | Commit |
|---|---|---|---|
| DEFSESS-3 | Eliminace DEFAULT_SESSION | pending | |
| SESS-2 | Sjednocení duálního session trackingu | pending | |
| TXCONF-1 | txActiveConfidence — rozlišení jistého/odvozeného stavu | pending | |
| DUP-1 | Extrakce ephemeral session helperu | pending | |
| DUP-2 | Deduplikace logiky napříč drivery | pending | |
| ERR-1 | Robustnější isConnectionLevelError | pending | |
| ERR-2 | isRetriable() utility | pending | |
| RELEASE-1 | Idempotentní releaseSession | pending | |
