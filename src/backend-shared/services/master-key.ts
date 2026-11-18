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
	/** The keychain could not be used; the machine-derived key is in use. */
	| 'fallback'

export async function setupMasterKey(options: MasterKeyOptions): Promise<MasterKeyOutcome> {
	const { appDb, store, item, fallbackKey } = options
	const log = options.log ?? ((message: string) => console.warn(message))
	const recorded = appDb.getSetting(KEY_ITEM_SETTING) ?? LEGACY_KEY_ITEM

	let key: Uint8Array
	try {
		key = await getOrCreateKey(store, item)
	} catch (err) {
		log(`Keychain unavailable, falling back to machine-derived key: ${errorMessage(err)}`)
		if (fallbackKey) appDb.setLocalKey(fallbackKey)
		return 'fallback'
	}

	if (recorded === item) {
		appDb.setLocalKey(key, [fallbackKey])
		return 'current'
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

	if (!previous) return 'current'
	const stillNeeded = options.siblingDatabases.some((path) => databaseUsesKey(path, previous))
	if (stillNeeded) return 'migrated-kept-previous'
	try {
		await store.delete(recorded)
		return 'migrated'
	} catch (err) {
		log(`Could not remove the previous master key "${recorded}": ${errorMessage(err)}`)
		return 'migrated-delete-failed'
	}
}

async function getOrCreateKey(store: SecretStore, item: string): Promise<Uint8Array> {
	const existing = decodeKey(await store.get(item))
	if (existing) return existing
	const fresh = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
	await store.set(item, Buffer.from(fresh).toString('base64'))
	return fresh
}

function decodeKey(stored: string | null): Uint8Array | null {
	if (!stored) return null
	const bytes = new Uint8Array(Buffer.from(stored, 'base64'))
	return bytes.length === KEY_BYTES ? bytes : null
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
