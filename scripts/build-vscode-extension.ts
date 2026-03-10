/**
 * Bundles the VS Code extension host code with esbuild.
 * Native modules (better-sqlite3, pg, mysql2) and 'vscode' are externalized.
 * Bun-only modules are stubbed out (the VS Code extension uses Node.js drivers instead).
 *
 * Usage:
 *   bun scripts/build-vscode-extension.ts          # single build
 *   bun scripts/build-vscode-extension.ts --watch   # watch mode
 */
import * as esbuild from 'esbuild'
import { cpSync, existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const watch = process.argv.includes('--watch')
const root = resolve(import.meta.dir, '..')
const dist = resolve(root, 'dist-vscode')

mkdirSync(dist, { recursive: true })

// Copy extension manifest to dist
cpSync(
	resolve(root, 'src/backend-vscode/package.json'),
	resolve(dist, 'package.json'),
)

// Symlink node_modules so external deps (better-sqlite3, pg, mysql2) are resolvable
const nmLink = resolve(dist, 'node_modules')
if (!existsSync(nmLink)) {
	symlinkSync(resolve(root, 'node_modules'), nmLink)
}

/**
 * Plugin that stubs out Bun-only modules with empty exports.
 * The VS Code extension uses Node.js drivers (node-postgres-driver, node-sqlite-driver, etc.)
 * but backend-shared transitively imports Bun-native drivers that use 'bun', 'bun:sqlite', etc.
 * These code paths are never executed in VS Code, so we replace them with no-ops.
 */
const stubBunPlugin: esbuild.Plugin = {
	name: 'stub-bun',
	setup(build) {
		const bunModules = ['bun', 'bun:sqlite', 'bun:test', 'electrobun']

		build.onResolve({ filter: new RegExp(`^(${bunModules.join('|')})$`) }, (args) => ({
			path: args.path,
			namespace: 'stub-bun',
		}))

		build.onLoad({ filter: /.*/, namespace: 'stub-bun' }, () => ({
			contents: 'module.exports = {};',
			loader: 'js',
		}))
	},
}

const buildOptions: esbuild.BuildOptions = {
	entryPoints: [resolve(root, 'src/backend-vscode/extension.ts')],
	bundle: true,
	outfile: resolve(dist, 'extension.js'),
	format: 'cjs',
	platform: 'node',
	target: 'node18',
	sourcemap: true,
	plugins: [stubBunPlugin],
	external: [
		'vscode',
		'pg',
		'pg-native',
		'mysql2',
		'sql.js',
	],
	alias: {
		'@dotaz/shared': resolve(root, 'src/shared'),
		'@dotaz/backend-shared': resolve(root, 'src/backend-shared'),
	},
}

if (watch) {
	const ctx = await esbuild.context(buildOptions)
	await ctx.watch()
	console.log('Watching extension host for changes...')
} else {
	await esbuild.build(buildOptions)
	console.log('Extension host bundled → dist-vscode/extension.js')
}
