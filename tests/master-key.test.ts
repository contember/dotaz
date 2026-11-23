import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { encryptLocalPassword, tryDecryptLocalPassword } from '@dotaz/backend-shared/services/encryption'
import {
	BUN_TEAM_ID,
	KEY_CHECK_SETTING,
	KEY_ITEM_SETTING,
	keyFingerprint,
	keyItemFor,
	keyItemForPlatform,
	LEGACY_KEY_ITEM,
	parseDesignatedRequirement,
	readDesignatedRequirement,
	recordedKeyItem,
	type SecretStore,
	setupMasterKey,
	siblingAppDatabases,
} from '@dotaz/backend-shared/services/master-key'
import { AppDatabase, databaseUsesKey } from '@dotaz/backend-shared/storage/app-db'
import { keyNoticeFor } from '@dotaz/frontend-shared/stores/key-status'
import type { PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync as dirFiles, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A stand-in for the keychain. Items listed in `refuse` throw on read, the way
// Bun.secrets does when the user clicks Deny on the macOS prompt.
class FakeStore implements SecretStore {
	items = new Map<string, string>()
	refuse = new Set<string>()
	unavailable = false
	reads: string[] = []
	/** The next read of each item waits for its promise, like a keychain prompt nobody has answered yet. */
	holdNext = new Map<string, Promise<void>>()

	async get(name: string): Promise<string | null> {
		this.reads.push(name)
		const hold = this.holdNext.get(name)
		if (hold) {
			this.holdNext.delete(name)
			await hold
		}
		if (this.unavailable || this.refuse.has(name)) throw new Error('Keychain access denied')
		return this.items.get(name) ?? null
	}
	async set(name: string, value: string): Promise<void> {
		if (this.unavailable) throw new Error('Keychain access denied')
		this.items.set(name, value)
	}
	undeletable = new Set<string>()

	async delete(name: string): Promise<boolean> {
		if (this.unavailable || this.undeletable.has(name)) throw new Error('Keychain access denied')
		return this.items.delete(name)
	}
}

const BUN_REQUIREMENT = 'identifier bun and anchor apple generic and certificate leaf[subject.OU] = "7FRXF46ZSN"'
const APP_REQUIREMENT = 'identifier bun and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"'
const OTHER_REQUIREMENT = 'identifier bun and anchor apple generic and certificate leaf[subject.OU] = "ZYXWV98765"'

const pgConfig: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5432,
	database: 'app',
	user: 'admin',
	password: 'db-secret',
	sshTunnel: {
		enabled: true,
		host: 'bastion',
		port: 22,
		username: 'me',
		authMethod: 'key',
		keyPath: '/keys/id',
		keyPassphrase: 'ssh-secret',
	},
}

function randomKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32))
}

function encodeKey(key: Uint8Array): string {
	return Buffer.from(key).toString('base64')
}

function rawConfig(db: AppDatabase, id: string): PostgresConnectionConfig {
	const row = db.db.prepare('SELECT config FROM connections WHERE id = ?').get(id) as { config: string }
	return JSON.parse(row.config) as PostgresConnectionConfig
}

let root: string
const open: AppDatabase[] = []

/** An app database in its own channel folder under one app-data root, like Electrobun lays them out. */
function channelDb(channel: string): { db: AppDatabase; dir: string; path: string } {
	const dir = join(root, channel)
	mkdirSync(dir, { recursive: true })
	const path = join(dir, 'dotaz.db')
	const db = AppDatabase.create(path)
	open.push(db)
	return { db, dir, path }
}

/** A database from a version that kept the key in the legacy item. */
function legacyChannel(channel: string, store: FakeStore, legacyKey: Uint8Array) {
	store.items.set(LEGACY_KEY_ITEM, encodeKey(legacyKey))
	const ch = channelDb(channel)
	ch.db.setLocalKey(legacyKey)
	const conn = ch.db.createConnection({ name: 'Prod', config: pgConfig })
	return { ...ch, connId: conn.id }
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dotaz-master-key-'))
})

afterEach(() => {
	for (const db of open.splice(0)) db.close()
	rmSync(root, { recursive: true, force: true })
})

describe('keyItemFor', () => {
	test('names the item after the designated requirement', () => {
		expect(keyItemFor(APP_REQUIREMENT)).toBe(keyItemFor(APP_REQUIREMENT))
		expect(keyItemFor(APP_REQUIREMENT)).not.toBe(keyItemFor(BUN_REQUIREMENT))
		expect(keyItemFor(APP_REQUIREMENT)).toMatch(/^app-encryption-key-v2-[0-9a-f]{16}$/)
	})

	test('keeps the legacy item when the requirement is unknown (Linux, Windows, no codesign)', () => {
		expect(keyItemFor(null)).toBe(LEGACY_KEY_ITEM)
	})

	test("keeps the legacy item for Bun's own signature, which every official bun meets", () => {
		expect(keyItemFor(BUN_REQUIREMENT)).toBe(LEGACY_KEY_ITEM)
		expect(keyItemFor(BUN_REQUIREMENT.replace('"7FRXF46ZSN"', '7FRXF46ZSN'))).toBe(LEGACY_KEY_ITEM)
	})
})

describe('keyItemForPlatform', () => {
	test('on macOS an unknown requirement means "keep the recorded item"', () => {
		expect(keyItemForPlatform(null, 'darwin')).toBeNull()
		expect(keyItemForPlatform(APP_REQUIREMENT, 'darwin')).toBe(keyItemFor(APP_REQUIREMENT))
	})

	test('elsewhere it is the legacy item', () => {
		expect(keyItemForPlatform(null, 'linux')).toBe(LEGACY_KEY_ITEM)
		expect(keyItemForPlatform(null, 'win32')).toBe(LEGACY_KEY_ITEM)
	})
})

describe('parseDesignatedRequirement', () => {
	test('reads an explicit requirement', () => {
		expect(parseDesignatedRequirement(`Executable=/x/bun\ndesignated => ${BUN_REQUIREMENT}\n`)).toBe(BUN_REQUIREMENT)
	})

	test('reads the implicit requirement of an ad-hoc signature', () => {
		expect(parseDesignatedRequirement('# designated => cdhash H"d066c5b9b11ed38994139e2dc35dbe03d762c654"\n'))
			.toBe('cdhash H"d066c5b9b11ed38994139e2dc35dbe03d762c654"')
	})

	test('returns null for unsigned code', () => {
		expect(parseDesignatedRequirement('code object is not signed at all\n')).toBeNull()
	})

	test.skipIf(process.platform !== 'darwin')('reads the requirement of the running bun through codesign', () => {
		const requirement = readDesignatedRequirement(process.execPath)
		expect(requirement).not.toBeNull()
		expect(requirement!).not.toContain('\n')
		// An official bun maps to the legacy item; a self-built one to its own item.
		const expected = requirement!.includes(BUN_TEAM_ID) ? LEGACY_KEY_ITEM : expect.stringMatching(/^app-encryption-key-v2-/)
		expect(keyItemFor(requirement)).toEqual(expected)
	})
})

describe('setupMasterKey', () => {
	test('a fresh install creates the bound item and records it', async () => {
		const store = new FakeStore()
		const { db } = channelDb('Dotaz')
		const item = keyItemFor(APP_REQUIREMENT)

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('current')
		expect(store.items.has(item)).toBe(true)
		expect(db.getSetting(KEY_ITEM_SETTING)).toBe(item)
	})

	test('moves the key out of the legacy item, re-encrypts every secret and removes the old item', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, connId } = legacyChannel('Dotaz', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('migrated')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(false)
		expect(db.getSetting(KEY_ITEM_SETTING)).toBe(item)

		const found = db.getConnectionById(connId)!.config as PostgresConnectionConfig
		expect(found.password).toBe('db-secret')
		expect(found.sshTunnel?.keyPassphrase).toBe('ssh-secret')

		const raw = rawConfig(db, connId)
		expect(tryDecryptLocalPassword(raw.password, legacyKey)).toBeNull()
		expect(tryDecryptLocalPassword(raw.sshTunnel!.keyPassphrase!, legacyKey)).toBeNull()
		const newKey = new Uint8Array(Buffer.from(store.items.get(item)!, 'base64'))
		expect(tryDecryptLocalPassword(raw.password, newKey)).toBe('db-secret')
	})

	test.each([KEY_ITEM_SETTING, KEY_CHECK_SETTING])(
		'a move interrupted while writing %s leaves one consistent key and every password readable',
		async (interruptedSetting) => {
			const store = new FakeStore()
			const { db, path, connId } = legacyChannel('Dotaz', store, randomKey())
			// An earlier start on the legacy item recorded that item's fingerprint.
			expect(await setupMasterKey({ appDb: db, store, item: LEGACY_KEY_ITEM, fallbackKey: null, siblingDatabases: [] })).toBe('current')
			const item = keyItemFor(APP_REQUIREMENT)

			// The process dies (power loss, kill) while this setting is written.
			const setSetting = db.setSetting.bind(db)
			db.setSetting = (key, value) => {
				if (key === interruptedSetting) throw new Error('process killed')
				setSetting(key, value)
			}
			await expect(setupMasterKey({ appDb: db, store, item, fallbackKey: null, siblingDatabases: [] })).rejects.toThrow('process killed')

			const restarted = AppDatabase.create(path)
			open.push(restarted)
			const recorded = restarted.getSetting(KEY_ITEM_SETTING) ?? LEGACY_KEY_ITEM
			expect([LEGACY_KEY_ITEM, item]).toContain(recorded)
			const recordedKey = new Uint8Array(Buffer.from(store.items.get(recorded)!, 'base64'))
			expect(restarted.getSetting(KEY_CHECK_SETTING)).toBe(keyFingerprint(recordedKey))
			const raw = rawConfig(restarted, connId)
			expect(tryDecryptLocalPassword(raw.password, recordedKey)).toBe('db-secret')
			expect(tryDecryptLocalPassword(raw.sshTunnel!.keyPassphrase!, recordedKey)).toBe('ssh-secret')

			expect(await setupMasterKey({ appDb: restarted, store, item, fallbackKey: null, siblingDatabases: [] })).toBe('migrated')
			const found = restarted.getConnectionById(connId)!.config as PostgresConnectionConfig
			expect(found.password).toBe('db-secret')
			expect(found.sshTunnel?.keyPassphrase).toBe('ssh-secret')
		},
	)

	test('the next start reads only the bound item', async () => {
		const store = new FakeStore()
		const { db } = legacyChannel('Dotaz', store, randomKey())
		const item = keyItemFor(APP_REQUIREMENT)
		await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })
		store.reads = []

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('current')
		expect(store.reads).toEqual([item])
	})

	test('when the old item is refused, nothing is lost and the next start tries again', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, connId } = legacyChannel('Dotaz', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)
		store.refuse.add(LEGACY_KEY_ITEM)

		const refused = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(refused).toBe('previous-unreadable')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(true)
		expect(db.getSetting(KEY_ITEM_SETTING)).toBeNull()
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, legacyKey)).toBe('db-secret')

		store.refuse.clear()
		const retried = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(retried).toBe('migrated')
		expect((db.getConnectionById(connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('a password saved while the old item was refused survives the later migration', async () => {
		const store = new FakeStore()
		const { db, connId } = legacyChannel('Dotaz', store, randomKey())
		const item = keyItemFor(APP_REQUIREMENT)
		store.refuse.add(LEGACY_KEY_ITEM)
		await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })
		const added = db.createConnection({ name: 'New', config: { ...pgConfig, password: 'added-later' } })

		store.refuse.clear()
		await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect((db.getConnectionById(connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
		expect((db.getConnectionById(added.id)!.config as PostgresConnectionConfig).password).toBe('added-later')
	})

	test('an unsigned dev channel keeps working on the legacy item after stable moved off it', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const dev = legacyChannel('Dotaz-dev', store, legacyKey)
		dev.db.setSetting(KEY_CHECK_SETTING, keyFingerprint(legacyKey))

		const moved = await setupMasterKey({
			appDb: stable.db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})
		const devStart = await setupMasterKey({
			appDb: dev.db,
			store,
			item: keyItemFor(BUN_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dev.dir, 'dotaz.db'),
		})

		expect(moved).toBe('migrated-kept-previous')
		expect(devStart).toBe('current')
		expect(store.items.get(LEGACY_KEY_ITEM)).toBe(encodeKey(legacyKey))
		expect((dev.db.getConnectionById(dev.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('keeps the old item while another channel still records it, even with no passwords saved there', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const dev = channelDb('Dotaz-dev')
		dev.db.setSetting(KEY_CHECK_SETTING, keyFingerprint(legacyKey))

		const moved = await setupMasterKey({
			appDb: stable.db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})

		expect(moved).toBe('migrated-kept-previous')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(true)
	})

	test('keeps the old item while another channel still needs it, and the last channel to move removes it', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const other = legacyChannel('Dotaz-other', store, legacyKey)

		const first = await setupMasterKey({
			appDb: stable.db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})
		expect(first).toBe('migrated-kept-previous')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(true)

		const second = await setupMasterKey({
			appDb: other.db,
			store,
			item: keyItemFor(OTHER_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(other.dir, 'dotaz.db'),
		})
		expect(second).toBe('migrated')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(false)
		expect((stable.db.getConnectionById(stable.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
		expect((other.db.getConnectionById(other.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('a start where the requirement is unknown keeps the recorded item and moves nothing', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		legacyChannel('Dotaz-dev', store, legacyKey)
		const signed = keyItemFor(APP_REQUIREMENT)
		await setupMasterKey({
			appDb: stable.db,
			store,
			item: signed,
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})
		const signedValue = store.items.get(signed)
		store.reads = []

		const outcome = await setupMasterKey({
			appDb: stable.db,
			store,
			item: keyItemForPlatform(null, 'darwin'),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})

		expect(outcome).toBe('current')
		expect(store.reads).toEqual([signed])
		expect(store.items.get(signed)).toBe(signedValue)
		expect(stable.db.getSetting(KEY_ITEM_SETTING)).toBe(signed)
		expect((stable.db.getConnectionById(stable.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('a channel that moved with no passwords saved still vouches for the shared item', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		store.items.set(LEGACY_KEY_ITEM, encodeKey(legacyKey))
		const stable = channelDb('Dotaz')
		const canary = legacyChannel('Dotaz-canary', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)

		await setupMasterKey({ appDb: stable.db, store, item, fallbackKey: randomKey(), siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db') })
		await setupMasterKey({ appDb: canary.db, store, item, fallbackKey: randomKey(), siblingDatabases: siblingAppDatabases(canary.dir, 'dotaz.db') })
		const restart = await setupMasterKey({
			appDb: stable.db,
			store,
			item,
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})

		expect(restart).toBe('current')
		expect((canary.db.getConnectionById(canary.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('two channels with the same identity starting at once both keep their passwords', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const canary = legacyChannel('Dotaz-canary', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)
		const lockPath = join(root, 'master-key.lock')
		const start = (ch: typeof stable) =>
			setupMasterKey({ appDb: ch.db, store, item, fallbackKey: randomKey(), siblingDatabases: siblingAppDatabases(ch.dir, 'dotaz.db'), lockPath })

		await Promise.all([start(stable), start(canary)])
		const restarts = await Promise.all([start(stable), start(canary)])

		expect(restarts).toEqual(['current', 'current'])
		expect(existsSync(lockPath)).toBe(false)
		expect((stable.db.getConnectionById(stable.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
		expect((canary.db.getConnectionById(canary.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('a channel waiting on another one that sits on the keychain prompt defers its move instead of taking over', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const canary = legacyChannel('Dotaz-canary', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)
		const lockPath = join(root, 'master-key.lock')
		const start = (ch: typeof stable) =>
			setupMasterKey({
				appDb: ch.db,
				store,
				item,
				fallbackKey: randomKey(),
				siblingDatabases: siblingAppDatabases(ch.dir, 'dotaz.db'),
				lockPath,
				lockWaitMs: 200,
			})
		let answerPrompt!: () => void
		store.holdNext.set(LEGACY_KEY_ITEM, new Promise<void>((resolve) => (answerPrompt = resolve)))

		const stableStart = start(stable)
		await Bun.sleep(250)
		const stableItemValue = store.items.get(item)
		const canaryStart = await start(canary)

		expect(canaryStart).toBe('move-deferred')
		expect(store.items.get(item)).toBe(stableItemValue!)
		expect(canary.db.getSetting(KEY_ITEM_SETTING)).toBeNull()
		expect((canary.db.getConnectionById(canary.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')

		answerPrompt()
		expect(await stableStart).toBe('migrated-kept-previous')
		expect(await start(canary)).toBe('migrated')
		expect(await start(stable)).toBe('current')
		expect(store.items.has(LEGACY_KEY_ITEM)).toBe(false)
		expect(existsSync(lockPath)).toBe(false)
		expect((stable.db.getConnectionById(stable.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
		expect((canary.db.getConnectionById(canary.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('a lock held by a live process is left alone', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())
		const lockPath = join(root, 'master-key.lock')
		writeFileSync(lockPath, `${process.pid} someone-else`)

		const outcome = await setupMasterKey({
			appDb: db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dir, 'dotaz.db'),
			lockPath,
			lockWaitMs: 150,
		})

		expect(outcome).toBe('move-deferred')
		expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid} someone-else`)
	})

	test('a lock left by a process that is gone is taken over', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())
		const lockPath = join(root, 'master-key.lock')
		const gone = Bun.spawnSync(['true']).pid
		writeFileSync(lockPath, `${gone} crashed`)

		const outcome = await setupMasterKey({
			appDb: db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dir, 'dotaz.db'),
			lockPath,
			lockWaitMs: 150,
		})

		expect(outcome).toBe('migrated')
		expect(existsSync(lockPath)).toBe(false)
	})

	test('a start that took over a stale lock backs off when another start took it over right after', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())
		const item = keyItemFor(APP_REQUIREMENT)
		const lockPath = join(root, 'master-key.lock')
		const stale = `${Bun.spawnSync(['true']).pid} crashed`
		writeFileSync(lockPath, stale)

		const outcome = setupMasterKey({
			appDb: db,
			store,
			item,
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dir, 'dotaz.db'),
			lockPath,
			lockWaitMs: 150,
		})
		// This start has replaced the stale lock with its own. Another start that
		// read the same stale lock now removes this one and creates its own.
		const taken = readFileSync(lockPath, 'utf8')
		expect(taken).not.toBe(stale)
		expect(taken.startsWith(`${process.pid} `)).toBe(true)
		rmSync(lockPath)
		writeFileSync(lockPath, `${process.pid} other-start`)

		expect(await outcome).toBe('move-deferred')
		expect(store.items.has(item)).toBe(false)
		expect(db.getSetting(KEY_ITEM_SETTING)).toBeNull()
		expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid} other-start`)
	})

	test('a lock is taken over once it is older than anyone leaves the prompt open, or names pid 1', async () => {
		for (const [content, ageMinutes] of [[`${process.pid} reused-pid`, 11], ['1 init', 0]] as const) {
			const store = new FakeStore()
			const { db } = legacyChannel(`Dotaz-${ageMinutes}`, store, randomKey())
			const lockPath = join(root, `master-key-${ageMinutes}.lock`)
			writeFileSync(lockPath, content)
			const then = new Date(Date.now() - ageMinutes * 60_000)
			utimesSync(lockPath, then, then)

			const outcome = await setupMasterKey({
				appDb: db,
				store,
				item: keyItemFor(APP_REQUIREMENT),
				fallbackKey: randomKey(),
				siblingDatabases: [],
				lockPath,
				lockWaitMs: 150,
			})

			expect(outcome).toBe('migrated')
		}
		expect(dirFiles(root).filter((name) => name.endsWith('.lock'))).toEqual([])
	})

	test('a deferred start still refuses a key swapped into the recorded item', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, dir } = legacyChannel('Dotaz', store, legacyKey)
		db.setSetting(KEY_CHECK_SETTING, keyFingerprint(legacyKey))
		store.items.set(LEGACY_KEY_ITEM, encodeKey(randomKey()))
		const lockPath = join(root, 'master-key.lock')
		writeFileSync(lockPath, `${process.pid} someone-else`)

		const outcome = await setupMasterKey({
			appDb: db,
			store,
			item: keyItemFor(APP_REQUIREMENT),
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dir, 'dotaz.db'),
			lockPath,
			lockWaitMs: 150,
		})

		expect(outcome).toBe('key-mismatch')
	})

	test('an unreadable file in another channel folder does not vouch for a planted item', async () => {
		const store = new FakeStore()
		const { db, dir, connId } = legacyChannel('Dotaz', store, randomKey())
		mkdirSync(join(root, 'Dotaz-junk'))
		writeFileSync(join(root, 'Dotaz-junk', 'dotaz.db'), 'not a database')
		const item = keyItemFor(APP_REQUIREMENT)
		const planted = randomKey()
		store.items.set(item, encodeKey(planted))

		await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: siblingAppDatabases(dir, 'dotaz.db') })

		expect(store.items.get(item)).not.toBe(encodeKey(planted))
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, planted)).toBeNull()
	})

	test('replaces an item planted under the new name instead of encrypting with its key', async () => {
		const store = new FakeStore()
		const { db, connId } = legacyChannel('Dotaz', store, randomKey())
		const item = keyItemFor(APP_REQUIREMENT)
		const planted = randomKey()
		store.items.set(item, encodeKey(planted))

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('migrated')
		expect(store.items.get(item)).not.toBe(encodeKey(planted))
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, planted)).toBeNull()
		expect((db.getConnectionById(connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('keeps the old item when a planted item cannot be removed', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, connId } = legacyChannel('Dotaz', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)
		const planted = randomKey()
		store.items.set(item, encodeKey(planted))
		store.undeletable.add(item)

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('item-unavailable')
		expect(db.getSetting(KEY_ITEM_SETTING)).toBeNull()
		expect(store.items.get(LEGACY_KEY_ITEM)).toBe(encodeKey(legacyKey))
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, legacyKey)).toBe('db-secret')
		const added = db.createConnection({ name: 'New', config: pgConfig })
		expect(tryDecryptLocalPassword(rawConfig(db, added.id).password, planted)).toBeNull()
		expect(tryDecryptLocalPassword(rawConfig(db, added.id).password, legacyKey)).toBe('db-secret')
	})

	test('refuses a key swapped into the recorded item', async () => {
		const store = new FakeStore()
		const { db, connId } = legacyChannel('Dotaz', store, randomKey())
		const item = keyItemFor(APP_REQUIREMENT)
		await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })
		const real = new Uint8Array(Buffer.from(store.items.get(item)!, 'base64'))
		const planted = randomKey()
		store.items.set(item, encodeKey(planted))

		const outcome = await setupMasterKey({ appDb: db, store, item, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('key-mismatch')
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, real)).toBe('db-secret')
		const added = db.createConnection({ name: 'New', config: pgConfig })
		expect(tryDecryptLocalPassword(rawConfig(db, added.id).password, planted)).toBeNull()
	})

	test('a channel with the same identity reuses the item another channel already moved to', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const stable = legacyChannel('Dotaz', store, legacyKey)
		const canary = legacyChannel('Dotaz-canary', store, legacyKey)
		const item = keyItemFor(APP_REQUIREMENT)

		await setupMasterKey({ appDb: canary.db, store, item, fallbackKey: randomKey(), siblingDatabases: siblingAppDatabases(canary.dir, 'dotaz.db') })
		const outcome = await setupMasterKey({
			appDb: stable.db,
			store,
			item,
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(stable.dir, 'dotaz.db'),
		})

		expect(outcome).toBe('migrated')
		expect([...store.items.keys()]).toEqual([item])
		expect((canary.db.getConnectionById(canary.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
		expect((stable.db.getConnectionById(stable.connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('moves again when the program identity changes later', async () => {
		const store = new FakeStore()
		const { db, connId } = legacyChannel('Dotaz', store, randomKey())
		const first = keyItemFor(APP_REQUIREMENT)
		const second = keyItemFor(OTHER_REQUIREMENT)
		await setupMasterKey({ appDb: db, store, item: first, fallbackKey: randomKey(), siblingDatabases: [] })

		const outcome = await setupMasterKey({ appDb: db, store, item: second, fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('migrated')
		expect([...store.items.keys()]).toEqual([second])
		expect((db.getConnectionById(connId)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('still re-encrypts secrets left under the hostname-derived key', async () => {
		const store = new FakeStore()
		const hostKey = randomKey()
		const { db } = channelDb('Dotaz')
		const conn = db.createConnection({ name: 'Old', config: pgConfig })
		db.db.prepare('UPDATE connections SET config = ? WHERE id = ?')
			.run(JSON.stringify({ ...pgConfig, password: encryptLocalPassword('db-secret', hostKey), sshTunnel: undefined }), conn.id)

		await setupMasterKey({ appDb: db, store, item: keyItemFor(APP_REQUIREMENT), fallbackKey: hostKey, siblingDatabases: [] })

		expect(tryDecryptLocalPassword(rawConfig(db, conn.id).password, hostKey)).toBeNull()
		expect((db.getConnectionById(conn.id)!.config as PostgresConnectionConfig).password).toBe('db-secret')
	})

	test('falls back to the machine-derived key when the keychain is unavailable, touching no items', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db } = legacyChannel('Dotaz', store, legacyKey)
		store.unavailable = true
		const hostKey = randomKey()

		const outcome = await setupMasterKey({ appDb: db, store, item: keyItemFor(APP_REQUIREMENT), fallbackKey: hostKey, siblingDatabases: [] })

		expect(outcome).toBe('fallback')
		expect(store.items.get(LEGACY_KEY_ITEM)).toBe(encodeKey(legacyKey))
		expect(db.getSetting(KEY_ITEM_SETTING)).toBeNull()
		const added = db.createConnection({ name: 'Offline', config: pgConfig })
		expect(tryDecryptLocalPassword(rawConfig(db, added.id).password, hostKey)).toBe('db-secret')
	})

	test('leaves the legacy item in place where there is no code identity to bind to', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, connId } = legacyChannel('Dotaz', store, legacyKey)

		const outcome = await setupMasterKey({ appDb: db, store, item: keyItemFor(null), fallbackKey: randomKey(), siblingDatabases: [] })

		expect(outcome).toBe('current')
		expect(store.items.get(LEGACY_KEY_ITEM)).toBe(encodeKey(legacyKey))
		expect(tryDecryptLocalPassword(rawConfig(db, connId).password, legacyKey)).toBe('db-secret')
	})
})

describe('databaseUsesKey', () => {
	test('tells whether a database still holds a secret for the key', () => {
		const key = randomKey()
		const { db, path } = channelDb('Dotaz')
		db.setLocalKey(key)
		db.createConnection({ name: 'Prod', config: pgConfig })

		expect(databaseUsesKey(path, key, false)).toBe(true)
		expect(databaseUsesKey(path, randomKey(), true)).toBe(false)
	})

	test("gives the caller's answer for a file it cannot read", () => {
		const path = join(root, 'broken.db')
		writeFileSync(path, 'not a database')
		expect(databaseUsesKey(path, randomKey(), true)).toBe(true)
		expect(databaseUsesKey(path, randomKey(), false)).toBe(false)
	})
})

describe('siblingAppDatabases', () => {
	test('lists the other channels that have a database, not this one', () => {
		const stable = channelDb('Dotaz')
		const canary = channelDb('Dotaz-canary')
		mkdirSync(join(root, 'Dotaz-dev'))

		expect(siblingAppDatabases(stable.dir, 'dotaz.db')).toEqual([canary.path])
	})
})

describe('storage.keyStatus', () => {
	/** Starts the backend the way the desktop entry does and asks what the window would show. */
	async function startAndReport(db: AppDatabase, store: FakeStore, dir: string, item: string | null = null, lockPath?: string) {
		const outcome = await setupMasterKey({
			appDb: db,
			store,
			item,
			fallbackKey: randomKey(),
			siblingDatabases: siblingAppDatabases(dir, 'dotaz.db'),
			lockPath,
			lockWaitMs: 150,
		})
		const { handlers } = createHandlers(new ConnectionManager(db), undefined, db, undefined, {
			mode: 'desktop',
			masterKeyStatus: { outcome, item: recordedKeyItem(db) },
		})
		return handlers['storage.keyStatus']()
	}

	test('reports a refused key and the item holding it', async () => {
		const store = new FakeStore()
		const legacyKey = randomKey()
		const { db, dir } = legacyChannel('Dotaz', store, legacyKey)
		db.setSetting(KEY_CHECK_SETTING, keyFingerprint(legacyKey))
		store.items.set(LEGACY_KEY_ITEM, encodeKey(randomKey()))

		expect(await startAndReport(db, store, dir)).toEqual({ outcome: 'key-mismatch', item: LEGACY_KEY_ITEM })
	})

	test("names the recorded item, not the running program's, when a move falls back on a swapped key", async () => {
		const store = new FakeStore()
		const { db, dir } = channelDb('Dotaz')
		const recorded = keyItemFor(APP_REQUIREMENT)
		const original = randomKey()
		db.setSetting(KEY_ITEM_SETTING, recorded)
		db.setSetting(KEY_CHECK_SETTING, keyFingerprint(original))
		store.items.set(recorded, encodeKey(randomKey()))
		const running = keyItemFor(OTHER_REQUIREMENT)
		store.items.set(running, encodeKey(randomKey()))
		store.undeletable.add(running)

		expect(await startAndReport(db, store, dir, running)).toEqual({ outcome: 'key-mismatch', item: recorded })
	})

	test.each(['missing', 'refused'] as const)(
		'reports a failed move that leaves only the machine-derived key (recorded item %s), so the window shows the notice',
		async (recordedItem) => {
			const store = new FakeStore()
			const { db, dir } = legacyChannel('Dotaz', store, randomKey())
			if (recordedItem === 'missing') store.items.delete(LEGACY_KEY_ITEM)
			else store.refuse.add(LEGACY_KEY_ITEM)
			const running = keyItemFor(APP_REQUIREMENT)
			store.items.set(running, encodeKey(randomKey()))
			store.undeletable.add(running)

			const status = await startAndReport(db, store, dir, running)

			expect(status).toEqual({ outcome: 'fallback', item: LEGACY_KEY_ITEM })
			expect(keyNoticeFor(status)).not.toBeNull()
		},
	)

	test('reports a deferred move that leaves only the machine-derived key, so the window shows the notice', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())
		store.items.delete(LEGACY_KEY_ITEM)
		const lockPath = join(root, 'master-key.lock')
		writeFileSync(lockPath, `${process.pid} someone-else`)

		const status = await startAndReport(db, store, dir, keyItemFor(APP_REQUIREMENT), lockPath)

		expect(status).toEqual({ outcome: 'fallback', item: LEGACY_KEY_ITEM })
		expect(keyNoticeFor(status)).not.toBeNull()
	})

	test('reports an unavailable keychain', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())
		store.unavailable = true

		expect(await startAndReport(db, store, dir)).toEqual({ outcome: 'fallback', item: LEGACY_KEY_ITEM })
	})

	test('reports a normal start as current', async () => {
		const store = new FakeStore()
		const { db, dir } = legacyChannel('Dotaz', store, randomKey())

		expect(await startAndReport(db, store, dir)).toEqual({ outcome: 'current', item: LEGACY_KEY_ITEM })
	})

	test('reports nothing where the backend uses no keychain (web)', () => {
		const { db } = channelDb('Dotaz')
		const { handlers } = createHandlers(new ConnectionManager(db), undefined, db, undefined, { mode: 'web' })

		expect(handlers['storage.keyStatus']()).toBeNull()
	})
})
