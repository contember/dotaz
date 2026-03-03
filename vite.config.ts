import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig(({ mode }) => {
	const isWeb = mode === 'web'
	const isDemo = mode === 'demo'
	const isElectron = mode === 'electron'

	const root = isDemo
		? 'src/frontend-demo'
		: isElectron
		? 'src/frontend-electron'
		: isWeb
		? 'src/frontend-web'
		: 'src/frontend-desktop'

	return {
		plugins: [solid()],
		root,
		build: {
			outDir: resolve(__dirname, 'dist'),
			emptyOutDir: true,
		},
		server: {
			port: isDemo ? 6403 : isElectron ? 6404 : isWeb ? 6402 : 6400,
			strictPort: true,
			proxy: isElectron
				? {
					'/rpc': { target: 'ws://localhost:6405', ws: true },
					'/api': { target: 'http://localhost:6405' },
				}
				: isWeb
				? { '/rpc': { target: 'ws://localhost:6401', ws: true } }
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
		worker: isDemo
			? { format: 'es' as const }
			: undefined,
	}
})
