import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hkdfSync } from 'node:crypto'
import { ConnectionManager } from '../src/backend-shared/services/connection-manager'
import { isEncryptedPassword } from '../src/backend-shared/services/encryption'
import { AppDatabase } from '../src/backend-shared/storage/app-db'
import type { PostgresConnectionConfig, SshTunnelConfig } from '../src/shared/types/connection'

// ── Helpers ──────────────────────────────────────────────────

const pgConfigWithSsh: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'db.internal.example.com',
	port: 5432,
	database: 'mydb',
	user: 'admin',
	password: 'secret',
	sshTunnel: {
		enabled: true,
		host: 'bastion.example.com',
		port: 22,
		username: 'ubuntu',
		authMethod: 'password',
		password: 'ssh-secret',
	},
}

const pgConfigWithSshKey: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'db.internal.example.com',
	port: 5432,
	database: 'mydb',
	user: 'admin',
	password: 'secret',
	sshTunnel: {
		enabled: true,
		host: 'bastion.example.com',
		port: 22,
		username: 'ubuntu',
		authMethod: 'key',
		keyPath: '/home/user/.ssh/id_rsa',
		keyPassphrase: 'key-passphrase',
	},
}

const pgConfigNoSsh: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5432,
	database: 'mydb',
	user: 'admin',
	password: 'secret',
}

function deriveTestKey(): Uint8Array {
	return new Uint8Array(hkdfSync('sha256', 'test-secret', 'salt', 'dotaz-local', 32))
}

// ── Tests ────────────────────────────────────────────────────

describe('SSH Tunnel — Persistence', () => {
	let appDb: AppDatabase

	beforeEach(() => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
	})

	afterEach(() => {
		AppDatabase.resetInstance()
	})

	test('SSH tunnel config is persisted and loaded correctly', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		const loaded = appDb.getConnectionById(conn.id)!
		expect(loaded.config.type).toBe('postgresql')
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel).toBeDefined()
		expect(pgConfig.sshTunnel!.enabled).toBe(true)
		expect(pgConfig.sshTunnel!.host).toBe('bastion.example.com')
		expect(pgConfig.sshTunnel!.port).toBe(22)
		expect(pgConfig.sshTunnel!.username).toBe('ubuntu')
		expect(pgConfig.sshTunnel!.authMethod).toBe('password')
		expect(pgConfig.sshTunnel!.password).toBe('ssh-secret')
	})

	test('SSH key config is persisted and loaded correctly', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH Key',
			config: pgConfigWithSshKey,
		})

		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.authMethod).toBe('key')
		expect(pgConfig.sshTunnel!.keyPath).toBe('/home/user/.ssh/id_rsa')
		expect(pgConfig.sshTunnel!.keyPassphrase).toBe('key-passphrase')
	})

	test('connection without SSH tunnel loads with no sshTunnel field', () => {
		const conn = appDb.createConnection({
			name: 'PG no SSH',
			config: pgConfigNoSsh,
		})

		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel).toBeUndefined()
	})

	test('SSH tunnel config survives update', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		const updatedConfig: PostgresConnectionConfig = {
			...pgConfigWithSsh,
			sshTunnel: {
				...pgConfigWithSsh.sshTunnel!,
				host: 'new-bastion.example.com',
				port: 2222,
			},
		}

		appDb.updateConnection({
			id: conn.id,
			name: 'PG with SSH (updated)',
			config: updatedConfig,
		})

		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.host).toBe('new-bastion.example.com')
		expect(pgConfig.sshTunnel!.port).toBe(2222)
	})
})

describe('SSH Tunnel — Encryption', () => {
	let appDb: AppDatabase

	beforeEach(() => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
		appDb.setLocalKey(deriveTestKey())
	})

	afterEach(() => {
		AppDatabase.resetInstance()
	})

	test('SSH password is encrypted in storage', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		// Read raw JSON from database to verify encryption
		const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
		const rawConfig = JSON.parse(row.config)
		expect(isEncryptedPassword(rawConfig.sshTunnel.password)).toBe(true)
		expect(rawConfig.sshTunnel.password).not.toBe('ssh-secret')

		// But loading through AppDatabase should decrypt
		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.password).toBe('ssh-secret')
	})

	test('SSH key passphrase is encrypted in storage', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH Key',
			config: pgConfigWithSshKey,
		})

		// Read raw JSON from database
		const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
		const rawConfig = JSON.parse(row.config)
		expect(isEncryptedPassword(rawConfig.sshTunnel.keyPassphrase)).toBe(true)
		expect(rawConfig.sshTunnel.keyPassphrase).not.toBe('key-passphrase')

		// Loading should decrypt
		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.keyPassphrase).toBe('key-passphrase')
	})

	test('main password is also encrypted alongside SSH password', () => {
		const conn = appDb.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
		const rawConfig = JSON.parse(row.config)
		expect(isEncryptedPassword(rawConfig.password)).toBe(true)

		const loaded = appDb.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.password).toBe('secret')
	})

	test('migratePasswords encrypts SSH tunnel secrets for existing connections', () => {
		// Create connection before setting key (unencrypted)
		AppDatabase.resetInstance()
		const dbNoKey = AppDatabase.getInstance(':memory:')
		const conn = dbNoKey.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		// Verify password is plaintext
		const rowBefore = dbNoKey.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
		const rawBefore = JSON.parse(rowBefore.config)
		expect(rawBefore.sshTunnel.password).toBe('ssh-secret')

		// Now set the key, which triggers migration
		dbNoKey.setLocalKey(deriveTestKey())

		// Verify SSH password is now encrypted in raw storage
		const rowAfter = dbNoKey.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
		const rawAfter = JSON.parse(rowAfter.config)
		expect(isEncryptedPassword(rawAfter.sshTunnel.password)).toBe(true)

		// But loading should still decrypt
		const loaded = dbNoKey.getConnectionById(conn.id)!
		const pgConfig = loaded.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.password).toBe('ssh-secret')
	})
})

describe('SSH Tunnel — ConnectionManager', () => {
	let appDb: AppDatabase
	let manager: ConnectionManager

	beforeEach(() => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
		manager = new ConnectionManager(appDb)
	})

	afterEach(async () => {
		await manager.disconnectAll()
		AppDatabase.resetInstance()
	})

	test('createConnection persists SSH tunnel config', () => {
		const conn = manager.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		expect(conn.config.type).toBe('postgresql')
		const pgConfig = conn.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel).toBeDefined()
		expect(pgConfig.sshTunnel!.enabled).toBe(true)
		expect(pgConfig.sshTunnel!.host).toBe('bastion.example.com')
	})

	test('updateConnection preserves SSH tunnel config', () => {
		const conn = manager.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})

		const updated = manager.updateConnection({
			id: conn.id,
			name: 'PG with SSH (updated)',
			config: {
				...pgConfigWithSsh,
				sshTunnel: { ...pgConfigWithSsh.sshTunnel!, port: 2222 },
			},
		})

		const pgConfig = updated.config as PostgresConnectionConfig
		expect(pgConfig.sshTunnel!.port).toBe(2222)
	})

	test('listConnections returns SSH tunnel config', () => {
		manager.createConnection({
			name: 'PG with SSH',
			config: pgConfigWithSsh,
		})
		manager.createConnection({
			name: 'PG no SSH',
			config: pgConfigNoSsh,
		})

		const list = manager.listConnections()
		expect(list).toHaveLength(2)

		const withSsh = list.find(c => c.name === 'PG with SSH')!
		const withoutSsh = list.find(c => c.name === 'PG no SSH')!

		expect((withSsh.config as PostgresConnectionConfig).sshTunnel?.enabled).toBe(true)
		expect((withoutSsh.config as PostgresConnectionConfig).sshTunnel).toBeUndefined()
	})

	test('testConnection fails with error when SSH tunnel host is unreachable', async () => {
		const config: PostgresConnectionConfig = {
			...pgConfigWithSsh,
			sshTunnel: {
				enabled: true,
				host: '127.0.0.1',
				port: 59999, // non-existent SSH server
				username: 'test',
				authMethod: 'password',
				password: 'test',
			},
		}

		const result = await manager.testConnection(config)
		expect(result.success).toBe(false)
		expect(result.error).toBeTruthy()
	})

	test('testConnection skips tunnel when SSH is not enabled', async () => {
		const config: PostgresConnectionConfig = {
			...pgConfigNoSsh,
			sshTunnel: {
				enabled: false,
				host: 'bastion.example.com',
				port: 22,
				username: 'ubuntu',
				authMethod: 'password',
				password: 'secret',
			},
		}

		// Should fail because PG host is not reachable, but NOT because of SSH
		const result = await manager.testConnection(config)
		expect(result.success).toBe(false)
		// Error should be about PG connection, not SSH
		expect(result.error).not.toContain('SSH')
	})
})
