import type { ConnectionConfig } from '@dotaz/shared/types/connection'

export const ENV_CONNECTION_ID = 'env-default'

export interface EnvConnection {
	name: string
	config: ConnectionConfig
}

export function parseEnvConnection(): EnvConnection | null {
	const url = process.env.DATABASE_URL
	if (!url) return null

	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		console.warn('DATABASE_URL: invalid URL, ignoring')
		return null
	}

	const scheme = parsed.protocol.replace(/:$/, '')

	if (scheme === 'postgresql' || scheme === 'postgres') {
		const host = parsed.hostname || 'localhost'
		const port = parsed.port ? Number(parsed.port) : 5432
		const database = parsed.pathname.replace(/^\//, '') || 'postgres'
		const user = decodeURIComponent(parsed.username || 'postgres')
		const password = decodeURIComponent(parsed.password || '')

		return {
			name: `${host}/${database}`,
			config: {
				type: 'postgresql',
				host,
				port,
				database,
				user,
				password,
			},
		}
	}

	if (scheme === 'mysql') {
		const host = parsed.hostname || 'localhost'
		const port = parsed.port ? Number(parsed.port) : 3306
		const database = parsed.pathname.replace(/^\//, '') || 'mysql'
		const user = decodeURIComponent(parsed.username || 'root')
		const password = decodeURIComponent(parsed.password || '')

		return {
			name: `${host}/${database}`,
			config: {
				type: 'mysql',
				host,
				port,
				database,
				user,
				password,
			},
		}
	}

	console.warn(`DATABASE_URL: unsupported scheme "${scheme}", ignoring`)
	return null
}
