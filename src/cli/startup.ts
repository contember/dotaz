import { isLoopbackHost } from '@dotaz/backend-web/auth'

export function hasExplicitEncryptionKey(encryptionKey: string | undefined): boolean {
	return typeof encryptionKey === 'string' && encryptionKey.trim().length > 0
}

export function validateEncryptionKeyStartup(bindHost: string, encryptionKey: string | undefined): string | null {
	if (hasExplicitEncryptionKey(encryptionKey)) return null
	if (isLoopbackHost(bindHost)) return null

	return 'DOTAZ_ENCRYPTION_KEY is required when binding Dotaz to a non-loopback host. Set it to a stable random value so saved credentials remain decryptable across restarts.'
}
