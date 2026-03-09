#!/usr/bin/env bun
// CLI entry point for `bunx dotaz`
// Parses arguments, auto-generates encryption key, and starts the web server

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

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

// Auto-generate encryption key for session security
if (!process.env.DOTAZ_ENCRYPTION_KEY) {
	process.env.DOTAZ_ENCRYPTION_KEY = randomBytes(32).toString('hex')
}

process.env.DOTAZ_PORT = String(port)
process.env.DOTAZ_HOST = host
process.env.DOTAZ_DIST_DIR = resolve(import.meta.dir, '../dist')

// Start the server (side-effectful import)
await import('../backend-web/server')
