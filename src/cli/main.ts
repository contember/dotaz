#!/usr/bin/env bun
// CLI entry point for `bunx @dotaz/server`
// Parses arguments, manages encryption key via OS keychain, and starts the web server

import { secrets } from 'bun'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const SERVICE = 'dev.dotaz.server'
const KEY_NAME = 'encryption-key'

const args = process.argv.slice(2)

let port = 6401
let host = 'localhost'

for (let i = 0; i < args.length; i++) {
	const arg = args[i]
	if ((arg === '--port' || arg === '-p') && args[i + 1]) {
		port = Number(args[i + 1])
		i++
	} else if ((arg === '--host' || arg === '-H') && args[i + 1]) {
		host = args[i + 1]
		i++
	} else if (arg === '--help') {
		console.log(`Usage: dotaz [options]

Options:
  -p, --port <port>  Port to listen on (default: 6401)
  -H, --host <host>  Host to bind to (default: localhost)
  --help             Show this help message
`)
		process.exit(0)
	}
}

// Resolve encryption key: env > OS keychain > auto-generate and persist
if (!process.env.DOTAZ_ENCRYPTION_KEY) {
	let key = await secrets.get({ service: SERVICE, name: KEY_NAME })

	if (!key) {
		key = randomBytes(32).toString('hex')
		try {
			await secrets.set({ service: SERVICE, name: KEY_NAME, value: key })
		} catch {
			// OS keychain unavailable (e.g. headless server, Docker) — key lives only in memory
		}
	}

	process.env.DOTAZ_ENCRYPTION_KEY = key
}

process.env.DOTAZ_PORT = String(port)
process.env.DOTAZ_HOST = host
process.env.DOTAZ_DIST_DIR = resolve(import.meta.dir, '../dist')

// Start the server (side-effectful import)
await import('@dotaz/backend-web/server')
