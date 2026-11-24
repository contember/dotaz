// The master key that encrypts saved connection passwords, and which program may
// read it from the macOS keychain without asking. See docs/keychain.md.
//
// Bun.secrets writes items without an explicit access list, so macOS gives each
// item the default one: the program that created it may read it silently, matched
// by that program's designated requirement (its code-signing identity), and every
// other program gets a prompt. An access list is fixed when the item is created;
// updating the value keeps it.
//
// So the key lives in an item named after the designated requirement of the
// program that runs this backend. When that requirement changes (Dotaz starts
// shipping a backend signed with its own identity), the item name changes too:
// the new program creates a fresh item, which only it may read, with a fresh key,
// re-encrypts the saved passwords from the old key and then removes the old item.
// Reading the old item is the one moment macOS may ask the user.

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type AppDatabase, databaseUsesKey, readDatabaseSetting } from '../storage/app-db'

export const KEYCHAIN_SERVICE = 'dotaz'
/** The item every version before identity binding used, readable by any official `bun`. */
export const LEGACY_KEY_ITEM = 'app-encryption-key-v1'
/** App setting naming the item that holds the key this database is encrypted with. */
export const KEY_ITEM_SETTING = 'keychain.masterKeyItem'
/** App setting holding `keyFingerprint` of that key, so a substituted key is refused. */
export const KEY_CHECK_SETTING = 'keychain.masterKeyCheck'

const KEY_BYTES = 32

export interface SecretStore {
	/** Resolves null when the item does not exist; throws when access is refused. */
	get(name: string): Promise<string | null>
	set(name: string, value: string): Promise<void>
	delete(name: string): Promise<boolean>
}

export function bunSecretStore(service: string = KEYCHAIN_SERVICE): SecretStore {
	return {
		get: (name) => Bun.secrets.get({ service, name }),
		set: (name, value) => Bun.secrets.set({ service, name, value }),
		delete: (name) => Bun.secrets.delete({ service, name }),
	}
}

/**
 * The designated requirement of `executable`: the rule the keychain uses to
 * recognise the program later. Null off macOS or when `codesign` can't tell.
 */
export function readDesignatedRequirement(executable: string = process.execPath): string | null {
	if (process.platform !== 'darwin') return null
	try {
		const result = spawnSync('/usr/bin/codesign', ['-d', '-r-', executable], { encoding: 'utf8', timeout: 10_000 })
		if (result.status !== 0) return null
		return parseDesignatedRequirement(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
	} catch {
		return null
	}
}

/** Pulls the requirement out of `codesign -d -r-` output (explicit, or implicit for ad-hoc signatures). */
export function parseDesignatedRequirement(output: string): string | null {
	const match = /^(?:# )?designated => (.+)$/m.exec(output)
	return match ? match[1].trim() : null
}

/** Team ID in the signature of the official `bun` binaries. */
export const BUN_TEAM_ID = '7FRXF46ZSN'

/**
 * The keychain item for a program with this designated requirement. Bun's own
 * signature (unsigned Dotaz builds, dev builds) keeps the legacy item: binding to
 * it would gain nothing, since every official `bun` meets that requirement.
 */
export function keyItemFor(requirement: string | null): string {
	if (!requirement || isBunRequirement(requirement)) return LEGACY_KEY_ITEM
	const digest = createHash('sha256').update(requirement).digest('hex').slice(0, 16)
	return `app-encryption-key-v2-${digest}`
}

function isBunRequirement(requirement: string): boolean {
	return new RegExp(`subject\\.OU\\]\\s*=\\s*"?${BUN_TEAM_ID}"?`).test(requirement)
}

/**
 * The item for the running program, or null when that can't be told. On macOS a
 * missing requirement means `codesign` failed this time (a timeout on a busy
 * start, say), not that the program changed, so the caller keeps the recorded
 * item. Elsewhere there are no per-program access lists and the item is the legacy one.
 */
export function keyItemForPlatform(requirement: string | null, platform: string = process.platform): string | null {
	if (!requirement && platform === 'darwin') return null
	return keyItemFor(requirement)
}

/**
 * App databases of the other channels (stable, canary, dev) that sit next to
 * this one. They share the keychain items with it, so an item one of them still
 * needs must not be removed.
 */
export function siblingAppDatabases(userDataDir: string, fileName: string): string[] {
	const own = resolve(userDataDir)
	const parent = resolve(own, '..')
	try {
		return readdirSync(parent, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && resolve(parent, entry.name) !== own)
			.map((entry) => join(parent, entry.name, fileName))
			.filter((path) => existsSync(path))
	} catch {
		return []
	}
}

export interface MasterKeyOptions {
	appDb: AppDatabase
	store: SecretStore
	/** Item bound to the program running now, from `keyItemForPlatform`; null keeps the recorded item. */
	item: string | null
	/** Key derived from the machine, used when the keychain can't be used at all. */
	fallbackKey: Uint8Array | null
	/** Other channels' databases, from `siblingAppDatabases`. */
	siblingDatabases: string[]
	/**
	 * File shared by all channels that serialises moves, so two channels starting
	 * at once don't each create the shared item. No lock when absent.
	 */
	lockPath?: string
	/** How long to wait for another start's move before leaving this one to a later start. */
	lockWaitMs?: number
	log?: (message: string) => void
}

export type MasterKeyOutcome =
	/** The key was already in the right item. */
	| 'current'
	/** The key moved to `item`; the old item was removed. */
	| 'migrated'
	/** The key moved to `item`; the old item stays because another channel still needs it. */
	| 'migrated-kept-previous'
	/** The key moved, but removing the old item failed. */
	| 'migrated-delete-failed'
	/** The old item could not be read; it will be asked for again on the next start. */
	| 'previous-unreadable'
	/**
	 * The item under the new name could not be created (the keychain refused the
	 * write, or an item Dotaz can't vouch for sits there and could not be removed);
	 * the key stays in the recorded item (`fallback` when that item holds no readable key).
	 */
	| 'item-unavailable'
	/**
	 * Another start was still moving the key (its keychain prompt open, say); the key stays in
	 * the recorded item until the next start (`fallback` when that item holds no readable key).
	 */
	| 'move-deferred'
	/** The keychain holds a different key than the one this database recorded; it was refused. */
	| 'key-mismatch'
	/**
	 * The recorded item is gone although this database recorded its key's fingerprint, so saved
	 * passwords can't be decrypted. Nothing is recorded or created under that name, so a restored
	 * item works again; the machine-derived key is in use until then.
	 */
	| 'key-missing'
	/** No key from the keychain could be used (the keychain failed, or a move failed with the recorded item missing); the machine-derived key is in use. */
	| 'fallback'

/** What the window shows about the key: the start's outcome and the item the database records. */
export interface MasterKeyStatus {
	outcome: MasterKeyOutcome
	/** After `key-mismatch`, the item holding the refused key (the reset deletes it); after `key-missing`, the item that is gone. */
	item: string
}

type Log = (message: string) => void

/** The item that holds the key this database is encrypted with. */
export function recordedKeyItem(appDb: AppDatabase): string {
	return appDb.getSetting(KEY_ITEM_SETTING) ?? LEGACY_KEY_ITEM
}

export async function setupMasterKey(options: MasterKeyOptions): Promise<MasterKeyOutcome> {
	const log = options.log ?? ((message: string) => console.warn(message))
	const recorded = recordedKeyItem(options.appDb)
	const item = options.item ?? recorded
	if (item === recorded) return keepRecordedItem(options, item, log)
	return withLock(
		options.lockPath,
		options.lockWaitMs ?? LOCK_WAIT_MS,
		() => moveKey(options, recorded, item, log),
		() => {
			log(`Another Dotaz is moving the master key; keeping "${recorded}" for now`)
			return keepPrevious(options, recorded, log, 'move-deferred')
		},
	)
}

function fallBack(options: MasterKeyOptions, err: unknown, log: Log): MasterKeyOutcome {
	log(`Keychain unavailable, falling back to machine-derived key: ${errorMessage(err)}`)
	if (options.fallbackKey) options.appDb.setLocalKey(options.fallbackKey)
	return 'fallback'
}

async function keepRecordedItem(options: MasterKeyOptions, item: string, log: Log): Promise<MasterKeyOutcome> {
	const { appDb, store, fallbackKey } = options
	let key: Uint8Array | null
	try {
		key = decodeKey(await store.get(item))
		if (key) {
			// Anyone may add an item under a name nobody holds, so a key that differs
			// from the one this database recorded may be a planted one: never encrypt with it.
			const check = appDb.getSetting(KEY_CHECK_SETTING)
			if (check && check !== keyFingerprint(key)) {
				log(
					`The master key in keychain item "${item}" is not the one this database was encrypted with, so it is refused `
						+ 'and saved passwords are unavailable. See "Resetting the key" in docs/keychain.md.',
				)
				if (fallbackKey) appDb.setLocalKey(fallbackKey)
				return 'key-mismatch'
			}
		} else if (appDb.getSetting(KEY_CHECK_SETTING)) {
			return keyMissing(options, item, log)
		} else {
			key = await createKey(store, item)
		}
	} catch (err) {
		return fallBack(options, err, log)
	}
	appDb.setLocalKey(key, [fallbackKey])
	appDb.setSetting(KEY_CHECK_SETTING, keyFingerprint(key))
	return 'current'
}

async function moveKey(options: MasterKeyOptions, recorded: string, item: string, log: Log): Promise<MasterKeyOutcome> {
	const { appDb, store, fallbackKey, siblingDatabases } = options

	let existing: Uint8Array | null
	try {
		existing = decodeKey(await store.get(item))
	} catch (err) {
		return fallBack(options, err, log)
	}

	// An item already under the new name is used only when a database of ours
	// vouches for it: another channel with the same identity moved first, or a
	// password was saved here while the old item was refused. Anything else could
	// have been planted by another program, with a key it knows and an access list
	// that lets it read the item, so it is replaced.
	let key: Uint8Array
	if (existing && (appDb.usesKey(existing) || siblingDatabases.some((path) => siblingVouchesFor(path, existing)))) {
		key = existing
	} else {
		try {
			if (existing) await store.delete(item)
			key = await createKey(store, item)
		} catch (err) {
			log(`Could not create the master key item "${item}": ${errorMessage(err)}`)
			return keepPrevious(options, recorded, log)
		}
	}

	let previous: Uint8Array | null
	try {
		previous = decodeKey(await store.get(recorded))
	} catch (err) {
		// Refused or failed: don't record the move, so the next start asks again
		// rather than leaving the saved passwords encrypted with a key nobody reads.
		log(`Could not read the previous master key "${recorded}": ${errorMessage(err)}`)
		appDb.setLocalKey(key, [fallbackKey])
		return 'previous-unreadable'
	}

	// Recording the move would encrypt with a new key for good and forget which one the saved
	// passwords need; left unrecorded, a restored item is moved on a later start.
	if (!previous && appDb.getSetting(KEY_CHECK_SETTING)) return keyMissing(options, recorded, log)

	// One transaction: a start that dies part-way must not record the new item with
	// the old fingerprint (refused for good) or leave secrets under an unrecorded key.
	appDb.transaction(() => {
		appDb.setLocalKey(key, [previous, fallbackKey])
		appDb.setSetting(KEY_ITEM_SETTING, item)
		appDb.setSetting(KEY_CHECK_SETTING, keyFingerprint(key))
	})

	if (!previous) return 'current'
	// Kept while another channel holds secrets under it or still records it as its
	// key (deleting it then would leave the name free for a planted item there).
	const stillNeeded = siblingDatabases.some((path) =>
		databaseUsesKey(path, previous, true) || readDatabaseSetting(path, KEY_CHECK_SETTING) === keyFingerprint(previous)
	)
	if (stillNeeded) return 'migrated-kept-previous'
	try {
		await store.delete(recorded)
		return 'migrated'
	} catch (err) {
		log(`Could not remove the previous master key "${recorded}": ${errorMessage(err)}`)
		return 'migrated-delete-failed'
	}
}

/**
 * The item holding this database's key is gone. A fresh key under its name would silently
 * leave every saved password undecryptable and block restoring the item, so use the
 * machine-derived key and leave the item and both settings as they are.
 */
function keyMissing(options: MasterKeyOptions, item: string, log: Log): MasterKeyOutcome {
	log(
		`The master key item "${item}" is missing from the keychain, so saved passwords are unavailable. `
			+ 'Restore the item, or see "When the key is missing" in docs/keychain.md.',
	)
	if (options.fallbackKey) options.appDb.setLocalKey(options.fallbackKey)
	return 'key-missing'
}

/** The move could not happen: carry on with the recorded item, as before this version. */
async function keepPrevious(
	options: MasterKeyOptions,
	recorded: string,
	log: Log,
	outcome: 'item-unavailable' | 'move-deferred' = 'item-unavailable',
): Promise<MasterKeyOutcome> {
	const { appDb, store, fallbackKey } = options
	try {
		const previous = decodeKey(await store.get(recorded))
		if (previous) {
			// Same check as keepRecordedItem: never encrypt with a substituted key.
			const check = appDb.getSetting(KEY_CHECK_SETTING)
			if (check && check !== keyFingerprint(previous)) {
				log(
					`The master key in keychain item "${recorded}" is not the one this database was encrypted with, so it is refused `
						+ 'and saved passwords are unavailable. See "Resetting the key" in docs/keychain.md.',
				)
				if (fallbackKey) appDb.setLocalKey(fallbackKey)
				return 'key-mismatch'
			}
			appDb.setLocalKey(previous, [fallbackKey])
			return outcome
		}
		log(`No master key in keychain item "${recorded}", falling back to machine-derived key`)
	} catch (err) {
		log(`Could not read the previous master key "${recorded}", falling back to machine-derived key: ${errorMessage(err)}`)
	}
	// No keychain key is in use, so the window must say so, as for an unavailable keychain.
	if (fallbackKey) appDb.setLocalKey(fallbackKey)
	return 'fallback'
}

/**
 * Another channel's database vouches for a key when it holds a secret that the
 * key decrypts or records the key's fingerprint (it moved there, perhaps with no
 * passwords saved yet). An unreadable database vouches for nothing.
 */
function siblingVouchesFor(path: string, key: Uint8Array): boolean {
	return databaseUsesKey(path, key, false) || readDatabaseSetting(path, KEY_CHECK_SETTING) === keyFingerprint(key)
}

const LOCK_WAIT_MS = 30_000
const LOCK_UNWRITTEN_STALE_MS = 60_000
const LOCK_MAX_AGE_MS = 10 * 60_000
const LOCK_SETTLE_MS = 100

/**
 * Runs `fn` holding a lock file, waiting for another holder to finish. The
 * holder may sit on the keychain prompt for as long as the user takes, so a
 * live holder's lock is never taken over: when the wait runs out, `onBusy` runs
 * instead and the move is left to a later start. A lock whose holder process is
 * gone is left over from a crash and is taken over. If the lock can't be created
 * at all (no permission, say), `fn` runs without it.
 */
async function withLock<T>(
	lockPath: string | undefined,
	waitMs: number,
	fn: () => Promise<T>,
	onBusy: () => Promise<T>,
): Promise<T> {
	if (!lockPath) return fn()
	const token = `${process.pid} ${randomUUID()}`
	const deadline = Date.now() + waitMs
	let held = false
	for (;;) {
		try {
			const fd = openSync(lockPath, 'wx')
			try {
				writeSync(fd, token)
			} finally {
				closeSync(fd)
			}
			// Taking over a stale lock is check-then-remove, so another start that
			// read the same stale lock may remove this fresh one and create its own.
			// Let that settle, and carry on only if the lock is still ours.
			await Bun.sleep(LOCK_SETTLE_MS)
			if (readLock(lockPath) !== token) continue
			held = true
			break
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') break
			if (!lockHolderAlive(lockPath)) {
				rmSync(lockPath, { force: true })
				continue
			}
			if (Date.now() > deadline) return onBusy()
			await Bun.sleep(100)
		}
	}
	try {
		return await fn()
	} finally {
		// Remove only our own lock, never one another start took over.
		if (held && readLock(lockPath) === token) rmSync(lockPath, { force: true })
	}
}

function readLock(lockPath: string): string | null {
	try {
		return readFileSync(lockPath, 'utf8')
	} catch {
		return null
	}
}

function lockHolderAlive(lockPath: string): boolean {
	const content = readLock(lockPath)
	if (content === null) return false
	let age: number
	try {
		age = Date.now() - statSync(lockPath).mtimeMs
	} catch {
		return false
	}
	// A process ID is reused after the holder dies (across a reboot, say), so no
	// lock is honoured for longer than anyone plausibly leaves the prompt open.
	if (age > LOCK_MAX_AGE_MS) return false
	const pid = Number.parseInt(content.split(' ')[0] ?? '', 10)
	// Created but not written yet, or garbage: trust it only while it is fresh.
	if (!Number.isInteger(pid)) return age < LOCK_UNWRITTEN_STALE_MS
	if (pid <= 1) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		// ESRCH: gone. EPERM: another user's process, so not a Dotaz of this user.
		return false
	}
}

/**
 * Adds a new item with a fresh key. Refuses when an item already exists:
 * `set` would then only replace the value and keep that item's access list.
 */
async function createKey(store: SecretStore, item: string): Promise<Uint8Array> {
	if ((await store.get(item)) !== null) throw new Error(`keychain item "${item}" already exists`)
	const fresh = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
	await store.set(item, Buffer.from(fresh).toString('base64'))
	return fresh
}

/** A one-way fingerprint of the key, stored in the app database to recognise it later. */
export function keyFingerprint(key: Uint8Array): string {
	return createHash('sha256').update('dotaz-master-key-check:').update(key).digest('hex')
}

function decodeKey(stored: string | null): Uint8Array | null {
	if (!stored) return null
	const bytes = new Uint8Array(Buffer.from(stored, 'base64'))
	return bytes.length === KEY_BYTES ? bytes : null
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
