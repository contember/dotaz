import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { parseEnvConnection } from '../src/backend-web/env-connection'

describe('parseEnvConnection', () => {
	let originalDatabaseUrl: string | undefined

	beforeEach(() => {
		originalDatabaseUrl = process.env.DATABASE_URL
	})

	afterEach(() => {
		if (originalDatabaseUrl !== undefined) {
			process.env.DATABASE_URL = originalDatabaseUrl
		} else {
			delete process.env.DATABASE_URL
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
})
