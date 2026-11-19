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
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type AppDatabase, databaseUsesKey } from '../storage/app-db'

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

/** The keychain item for a program with this designated requirement. */
export function keyItemFor(requirement: string | null): string {
	if (!requirement) return LEGACY_KEY_ITEM
	const digest = createHash('sha256').update(requirement).digest('hex').slice(0, 16)
	return `app-encryption-key-v2-${digest}`
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
	/** Item bound to the program running now, from `keyItemFor`. */
	item: string
	/** Key derived from the machine, used when the keychain can't be used at all. */
	fallbackKey: Uint8Array | null
	/** Other channels' databases, from `siblingAppDatabases`. */
	siblingDatabases: string[]
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
	 * An item Dotaz can't vouch for sits under the new name and could not be
	 * removed; the key stays where it was.
	 */
	| 'item-occupied'
	/** The keychain holds a different key than the one this database recorded; it was refused. */
	| 'key-mismatch'
	/** The keychain could not be used; the machine-derived key is in use. */
	| 'fallback'

export async function setupMasterKey(options: MasterKeyOptions): Promise<MasterKeyOutcome> {
	const { appDb, store, item, fallbackKey, siblingDatabases } = options
	const log = options.log ?? ((message: string) => console.warn(message))
	const recorded = appDb.getSetting(KEY_ITEM_SETTING) ?? LEGACY_KEY_ITEM

	const fallBack = (err: unknown): MasterKeyOutcome => {
		log(`Keychain unavailable, falling back to machine-derived key: ${errorMessage(err)}`)
		if (fallbackKey) appDb.setLocalKey(fallbackKey)
		return 'fallback'
	}

	let existing: Uint8Array | null
	try {
		existing = decodeKey(await store.get(item))
	} catch (err) {
		return fallBack(err)
	}

	if (recorded === item) {
		let key = existing
		if (key) {
			// Anyone may add an item under a name nobody holds, so a key that differs
			// from the one this database recorded may be a planted one: never encrypt with it.
			const check = appDb.getSetting(KEY_CHECK_SETTING)
			if (check && check !== keyFingerprint(key)) {
				log(`The master key in "${item}" is not the one this database was encrypted with; refusing it`)
				if (fallbackKey) appDb.setLocalKey(fallbackKey)
				return 'key-mismatch'
			}
		} else {
			try {
				key = await createKey(store, item)
			} catch (err) {
				return fallBack(err)
			}
		}
		appDb.setLocalKey(key, [fallbackKey])
		appDb.setSetting(KEY_CHECK_SETTING, keyFingerprint(key))
		return 'current'
	}

	// Moving the key to `item`. An item already under that name is used only when
	// a database of ours is encrypted with it (another channel with the same
	// identity moved first, or an earlier attempt here was interrupted). Anything
	// else could have been planted by another program, with a key it knows and an
	// access list that lets it read the item, so it is replaced.
	let key: Uint8Array
	if (existing && (appDb.usesKey(existing) || siblingDatabases.some((path) => databaseUsesKey(path, existing, false)))) {
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

	appDb.setLocalKey(key, [previous, fallbackKey])
	appDb.setSetting(KEY_ITEM_SETTING, item)
	appDb.setSetting(KEY_CHECK_SETTING, keyFingerprint(key))

	if (!previous) return 'current'
	const stillNeeded = siblingDatabases.some((path) => databaseUsesKey(path, previous, true))
	if (stillNeeded) return 'migrated-kept-previous'
	try {
		await store.delete(recorded)
		return 'migrated'
	} catch (err) {
		log(`Could not remove the previous master key "${recorded}": ${errorMessage(err)}`)
		return 'migrated-delete-failed'
	}
}

/** The move could not happen: carry on with the recorded item, as before this version. */
async function keepPrevious(options: MasterKeyOptions, recorded: string, log: (message: string) => void): Promise<MasterKeyOutcome> {
	const { appDb, store, fallbackKey } = options
	try {
		const previous = decodeKey(await store.get(recorded))
		if (previous) {
			appDb.setLocalKey(previous, [fallbackKey])
			return 'item-occupied'
		}
	} catch (err) {
		log(`Could not read the previous master key "${recorded}": ${errorMessage(err)}`)
	}
	if (fallbackKey) appDb.setLocalKey(fallbackKey)
	return 'item-occupied'
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
