# DOTAZ-061: Encrypt connection passwords in local storage

**Phase**: 8 — Gaps
**Type**: backend
**Dependencies**: [DOTAZ-004, DOTAZ-007]

## Description

Connection passwords are currently stored as plaintext JSON in the local SQLite app database (NFR-04). While encryption exists for stateless mode (via ENCRYPTION_KEY env var), the default local mode stores passwords unencrypted.

Implement local password encryption using a machine-derived key (e.g., from hostname + user + app-specific salt via HKDF). The key doesn't need to be highly secure (it's local-only), but passwords should not be trivially readable from the SQLite file.

## Files

- `src/backend-shared/services/encryption.ts` — add `createLocalKey()` that derives a key from machine-specific data
- `src/backend-shared/storage/app-db.ts` — encrypt password field when saving connections, decrypt when loading
- `src/backend-shared/services/connection-manager.ts` — ensure decrypted passwords are used when connecting

## Acceptance Criteria

- [ ] Passwords in the local SQLite database are not stored as plaintext
- [ ] Encryption uses a machine-derived key (no user-provided key needed)
- [ ] Existing plaintext passwords are migrated on first load (transparent upgrade)
- [ ] Decryption works correctly — connections still function after encryption
- [ ] Encryption does not affect stateless mode (which uses its own ENCRYPTION_KEY)
- [ ] If machine key derivation fails, falls back to plaintext with a warning log
