import type { ConnectionConfig } from '@dotaz/shared/types/connection'

export const ENV_CONNECTION_ID = 'env-default'

export interface EnvConnection {
	name: string
	config: ConnectionConfig
}

/**
 * Translate a libpq `options` connection parameter into re-runnable session-setup SQL.
 *
 * Each `-c key=value` token becomes a `SET key = 'value';` statement. Unlike forwarding
 * the option to the startup packet, this survives the pool's DISCARD ALL reset.
 * Returns '' when there is nothing to translate.
 */
export function libpqOptionsToInitSql(options: string): string {
	const statements: string[] = []
	// Tokens are separated by whitespace; backslash-escaped spaces are not handled
	// (rare for the GUC use-case). Match `-c key=value` pairs.
	const re = /-c\s+([^\s=]+)=([^\s]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(options)) !== null) {
		const key = m[1]
		const value = m[2].replace(/'/g, "''")
		statements.push(`SET ${key} = '${value}';`)
	}
	return statements.join('\n')
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

		// Session-setup SQL: DOTAZ_INIT_SQL takes precedence; otherwise translate a
		// libpq-style `?options=-c key=value` so standard libpq URLs work headlessly.
		const optionsParam = parsed.searchParams.get('options')
		const initSql = process.env.DOTAZ_INIT_SQL?.trim()
			|| (optionsParam ? libpqOptionsToInitSql(optionsParam) : '')
			|| undefined

		return {
			name: `${host}/${database}`,
			config: {
				type: 'postgresql',
				host,
				port,
				database,
				user,
				password,
				initSql,
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
