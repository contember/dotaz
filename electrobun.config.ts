import type { ElectrobunConfig } from 'electrobun'

export default {
	app: {
		name: 'Dotaz',
		identifier: 'dotaz.electrobun.dev',
		version: '0.0.1',
	},
	build: {
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
		},
		win: {
			bundleCEF: false,
			icon: 'assets/icon.png',
		},
	},
	release: {
		baseUrl: 'https://github.com/contember/dotaz/releases/latest/download',
		generatePatch: true,
	},
} satisfies ElectrobunConfig
