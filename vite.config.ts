import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import solid from 'vite-plugin-solid'

const demoWorker: NonNullable<UserConfig['worker']> = { format: 'es' }

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
