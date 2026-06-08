import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { libpqOptionsToInitSql, parseEnvConnection } from '../src/backend-web/env-connection'

describe('parseEnvConnection', () => {
	let originalDatabaseUrl: string | undefined
	let originalInitSql: string | undefined

	beforeEach(() => {
		originalDatabaseUrl = process.env.DATABASE_URL
		originalInitSql = process.env.DOTAZ_INIT_SQL
		delete process.env.DOTAZ_INIT_SQL
	})

	afterEach(() => {
		if (originalDatabaseUrl !== undefined) {
			process.env.DATABASE_URL = originalDatabaseUrl
		} else {
			delete process.env.DATABASE_URL
		}
		if (originalInitSql !== undefined) {
			process.env.DOTAZ_INIT_SQL = originalInitSql
		} else {
			delete process.env.DOTAZ_INIT_SQL
		}
	})

	test('returns null when DATABASE_URL is not set', () => {
		delete process.env.DATABASE_URL
		expect(parseEnvConnection()).toBeNull()
	})

	test('parses postgresql:// URL', () => {
		process.env.DATABASE_URL = 'postgresql://myuser:mypass@dbhost:5433/mydb'
		const result = parseEnvConnection()
		expect(result).toEqual({
			name: 'dbhost/mydb',
			config: {
				type: 'postgresql',
				host: 'dbhost',
				port: 5433,
				database: 'mydb',
				user: 'myuser',
				password: 'mypass',
			},
		})
	})

	test('parses postgres:// URL', () => {
		process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb'
		const result = parseEnvConnection()
		expect(result).toEqual({
			name: 'localhost/testdb',
			config: {
				type: 'postgresql',
				host: 'localhost',
				port: 5432,
				database: 'testdb',
				user: 'user',
				password: 'pass',
			},
		})
	})

	test('parses mysql:// URL', () => {
		process.env.DATABASE_URL = 'mysql://root:secret@mysql-host:3307/appdb'
		const result = parseEnvConnection()
		expect(result).toEqual({
			name: 'mysql-host/appdb',
			config: {
				type: 'mysql',
				host: 'mysql-host',
				port: 3307,
				database: 'appdb',
				user: 'root',
				password: 'secret',
			},
		})
	})

	test('uses default port when not specified (PostgreSQL)', () => {
		process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
		const result = parseEnvConnection()
		expect(result!.config).toMatchObject({
			type: 'postgresql',
			port: 5432,
		})
	})

	test('uses default port when not specified (MySQL)', () => {
		process.env.DATABASE_URL = 'mysql://user:pass@host/db'
		const result = parseEnvConnection()
		expect(result!.config).toMatchObject({
			type: 'mysql',
			port: 3306,
		})
	})

	test('handles special characters in password', () => {
		process.env.DATABASE_URL = 'postgresql://user:p%40ss%23w0rd%21@host/db'
		const result = parseEnvConnection()
		expect(result!.config).toMatchObject({
			password: 'p@ss#w0rd!',
		})
	})

	test('uses defaults when user/database are missing', () => {
		process.env.DATABASE_URL = 'postgresql://localhost'
		const result = parseEnvConnection()
		expect(result).toEqual({
			name: 'localhost/postgres',
			config: {
				type: 'postgresql',
				host: 'localhost',
				port: 5432,
				database: 'postgres',
				user: 'postgres',
				password: '',
			},
		})
	})

	test('returns null for unsupported scheme', () => {
		process.env.DATABASE_URL = 'mongodb://user:pass@host/db'
		expect(parseEnvConnection()).toBeNull()
	})

	test('returns null for invalid URL', () => {
		process.env.DATABASE_URL = 'not-a-valid-url'
		expect(parseEnvConnection()).toBeNull()
	})

	test('sets initSql from DOTAZ_INIT_SQL', () => {
		process.env.DATABASE_URL = 'postgres://user:pass@host/db'
		process.env.DOTAZ_INIT_SQL = "SET app.current_shop = 'acme'"
		expect(parseEnvConnection()!.config).toMatchObject({
			initSql: "SET app.current_shop = 'acme'",
		})
	})

	test('translates libpq ?options= into initSql', () => {
		process.env.DATABASE_URL = 'postgres://user:pass@host/db?options=-c%20app.current_shop%3Dacme'
		expect(parseEnvConnection()!.config).toMatchObject({
			initSql: "SET app.current_shop = 'acme';",
		})
	})

	test('DOTAZ_INIT_SQL takes precedence over ?options=', () => {
		process.env.DATABASE_URL = 'postgres://user:pass@host/db?options=-c%20app.current_shop%3Dfromurl'
		process.env.DOTAZ_INIT_SQL = "SET app.current_shop = 'fromenv'"
		expect(parseEnvConnection()!.config).toMatchObject({
			initSql: "SET app.current_shop = 'fromenv'",
		})
	})

	test('leaves initSql unset when neither source is present', () => {
		process.env.DATABASE_URL = 'postgres://user:pass@host/db'
		expect(parseEnvConnection()!.config).not.toHaveProperty('initSql', expect.anything())
		expect((parseEnvConnection()!.config as { initSql?: string }).initSql).toBeUndefined()
	})
})

describe('libpqOptionsToInitSql', () => {
	test('translates a single -c key=value', () => {
		expect(libpqOptionsToInitSql('-c app.current_shop=acme')).toBe("SET app.current_shop = 'acme';")
	})

	test('translates multiple -c options', () => {
		expect(libpqOptionsToInitSql('-c app.current_shop=acme -c statement_timeout=5000')).toBe(
			"SET app.current_shop = 'acme';\nSET statement_timeout = '5000';",
		)
	})

	test('escapes single quotes in values', () => {
		expect(libpqOptionsToInitSql("-c app.tenant=O'Brien")).toBe("SET app.tenant = 'O''Brien';")
	})

	test('returns empty string when there is nothing to translate', () => {
		expect(libpqOptionsToInitSql('')).toBe('')
		expect(libpqOptionsToInitSql('--some-flag')).toBe('')
	})
})
