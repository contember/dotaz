import { uiStore } from '../stores/ui'

/**
 * Copy text to the clipboard and surface a toast. Used by the read-only value
 * surfaces (row detail panel, FK peek popover) where the app's global
 * `user-select: none` and ellipsis truncation make manual select-and-copy
 * impractical, so an explicit copy button is the reliable path to the full value.
 */
export async function copyToClipboard(text: string, label = 'Copied to clipboard'): Promise<void> {
	try {
		await navigator.clipboard.writeText(text)
		uiStore.addToast('success', label)
	} catch {
		uiStore.addToast('error', 'Failed to copy to clipboard')
	}
}
