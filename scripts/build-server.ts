// Build script for the server distribution (bunx dotaz + Docker)
// Produces dist-server/ with bundled backend + pre-built frontend

import { resolve } from 'node:path'
import pkg from '../package.json'

const ROOT = resolve(import.meta.dir, '..')
const OUT = resolve(ROOT, 'dist-server')

const $ = Bun.$

// Clean previous build
await $`rm -rf ${OUT}`
await $`mkdir -p ${OUT}/bin`

console.log('Building frontend...')
await $`bunx vite build --mode web --outDir ${resolve(OUT, 'dist')}`

console.log('Bundling server...')
await Bun.build({
	entrypoints: [resolve(ROOT, 'src/cli/main.ts')],
	outdir: resolve(OUT, 'bin'),
	target: 'bun',
	minify: true,
	naming: 'dotaz.js',
})

// Make the binary executable
await $`chmod +x ${resolve(OUT, 'bin/dotaz.js')}`

// Write package.json for npm publishing
const serverPkg = {
	name: '@dotaz/server',
	version: process.env.VERSION || pkg.version,
	description: 'Desktop database client — server mode',
	license: pkg.license,
	author: pkg.author,
	bin: { dotaz: './bin/dotaz.js' },
	files: ['bin/', 'dist/'],
}

await Bun.write(resolve(OUT, 'package.json'), JSON.stringify(serverPkg, null, '\t') + '\n')

console.log(`Server build complete → ${OUT}`)
