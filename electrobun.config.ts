import type { ElectrobunConfig } from 'electrobun'
import pkg from './package.json'

export default {
	app: {
		name: 'Dotaz',
		identifier: 'dotaz.electrobun.dev',
		version: process.env.VERSION || pkg.version,
	},
	build: {
		// v2 defaults to the Cottontail runtime; dotaz needs real Bun for bun:sqlite + Bun.SQL.
		mainProcess: 'bun',
		bun: {
			entrypoint: 'src/backend-desktop/index.ts',
		},
		copy: {
			'dist/index.html': 'views/mainview/index.html',
			'dist/assets': 'views/mainview/assets',
			'scripts/seed/bookstore.db': 'resources/bookstore.db',
		},
		watchIgnore: ['dist/**'],
		mac: {
			bundleCEF: false,
			icons: 'assets/icon.iconset',
		},
		linux: {
			bundleCEF: true,
			defaultRenderer: 'cef',
			icon: 'assets/icon.png',
			chromiumFlags: {
				'disable-gpu': false,
				'disable-gpu-compositing': false,
				'disable-gpu-sandbox': false,
				'enable-software-rasterizer': false,
				'force-software-rasterizer': false,
				'disable-accelerated-2d-canvas': false,
				'disable-accelerated-video-decode': false,
				'disable-accelerated-video-encode': false,
				'disable-gpu-memory-buffer-video-frames': false,
			},
		},
		win: {
			bundleCEF: false,
			icon: 'assets/icon.ico',
		},
	},
	scripts: {
		postBuild: 'scripts/fix-linux-app-icon.ts',
	},
	release: {
		baseUrl: 'https://github.com/contember/dotaz/releases/latest/download',
		generatePatch: true,
	},
} satisfies ElectrobunConfig
