// How this start set up the key that encrypts saved passwords (docs/keychain.md). When the
// keychain key was refused or no keychain key could be used, the window says so: otherwise
// the user sees only empty saved passwords and does not know why.

import type { HandlerReturn } from '@dotaz/backend-types'
import { createSignal } from 'solid-js'
import { rpc } from '../lib/rpc'

export type KeyStatus = HandlerReturn<'storage.keyStatus'>

export interface KeyNotice {
	title: string
	detail: string
	linkLabel: string
	linkUrl: string
}

const KEYCHAIN_DOCS_URL = 'https://github.com/contember/dotaz/blob/main/docs/keychain.md'

/** The notice for a start, or null when the key is in order. */
export function keyNoticeFor(status: KeyStatus): KeyNotice | null {
	switch (status?.outcome) {
		case 'key-mismatch':
			return {
				title: "Saved passwords can't be decrypted",
				detail: `The key in keychain item "${status.item}" is not the one this app's database was encrypted with, so Dotaz refused it. `
					+ 'Passwords you save now are encrypted with a weaker key derived from this machine until you reset the key.',
				linkLabel: 'How to reset the key',
				linkUrl: `${KEYCHAIN_DOCS_URL}#resetting-the-key`,
			}
		case 'fallback':
			return {
				title: "Dotaz can't use its key in the system keychain",
				detail: "Passwords saved earlier can't be decrypted, and passwords you save now are encrypted with a weaker key "
					+ 'derived from this machine. If the keychain is locked or not running, unlock it '
					+ '(on Linux, start a Secret Service such as GNOME Keyring) and restart Dotaz.',
				linkLabel: 'About the keychain',
				linkUrl: `${KEYCHAIN_DOCS_URL}#what-dotaz-does-now`,
			}
		default:
			return null
	}
}

const [status, setStatus] = createSignal<KeyStatus>(null)
const [dismissed, setDismissed] = createSignal(false)

/** What the backend reported for this start; shown again even if an earlier notice was dismissed. */
function apply(next: KeyStatus) {
	setStatus(next)
	setDismissed(false)
}

/** Ask the backend once the transport is up. */
async function load() {
	try {
		apply(await rpc.storage.keyStatus())
	} catch (err) {
		console.debug('Key status unavailable:', err)
	}
}

export const keyStatusStore = {
	/** Shown until dismissed; a later start shows it again while the cause remains. */
	get notice(): KeyNotice | null {
		return dismissed() ? null : keyNoticeFor(status())
	},
	load,
	apply,
	dismiss: () => setDismissed(true),
}
