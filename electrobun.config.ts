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
		},
		watchIgnore: ['dist/**'],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: true,
			defaultRenderer: 'cef',
			icon: 'assets/icon.png',
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig
