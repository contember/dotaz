import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import solid from 'vite-plugin-solid'

const demoWorker: NonNullable<UserConfig['worker']> = { format: 'es' }

const DEVKIT = resolve(__dirname, '.hutch/devkit')

/**
 * Electrobun 2.x resolves its SDK from the Hutch devkit instead of node_modules,
 * so Vite needs explicit aliases derived from the projected export map.
 * Absent when Vite runs without Hutch (web/demo builds, Docker) — the desktop
 * entry is the only one importing `electrobun/view`.
 */
function electrobunAliases(): NonNullable<UserConfig['resolve']>['alias'] {
	const manifest = resolve(DEVKIT, 'package.json')
	if (!existsSync(manifest)) return undefined

	const exports: Record<string, string> = JSON.parse(readFileSync(manifest, 'utf8')).exports ?? {}
	return Object.entries(exports).flatMap(([subpath, target]) => {
		if (typeof target !== 'string' || !target.startsWith('./api/')) return []
		const specifier = subpath === '.' ? 'electrobun' : `electrobun/${subpath.slice(2)}`
		return [{ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: resolve(DEVKIT, target) }]
	})
}

export default defineConfig(({ mode }) => {
	const isWeb = mode === 'web'
	const isDemo = mode === 'demo'

	const root = isDemo
		? 'src/frontend-demo'
		: isWeb
		? 'src/frontend-web'
		: 'src/frontend-desktop'

	return {
		plugins: [solid()],
		root,
		resolve: { alias: electrobunAliases() },
		build: {
			outDir: resolve(__dirname, 'dist'),
			emptyOutDir: true,
		},
		server: {
			port: isDemo ? 6403 : isWeb ? 6402 : 6400,
			strictPort: true,
			proxy: isWeb
				? {
					'/api': { target: 'http://localhost:6401' },
					'/rpc': { target: 'ws://localhost:6401', ws: true },
				}
				: undefined,
			headers: isDemo
				? {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'require-corp',
				}
				: undefined,
		},
		optimizeDeps: isDemo
			? { exclude: ['@sqlite.org/sqlite-wasm'] }
			: undefined,
		worker: isDemo ? demoWorker : undefined,
	}
})
