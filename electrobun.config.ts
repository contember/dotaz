import type { ElectrobunConfig } from 'electrobun'

export default {
	app: {
		name: 'Dotaz',
		identifier: 'dotaz.electrobun.dev',
		version: '0.0.1',
	},
	bun: {
		entrypoint: 'src/backend-desktop/index.ts',
	},
	build: {
		copy: {
			'dist/index.html': 'views/mainview/index.html',
			'dist/assets': 'views/mainview/assets',
		},
		watchIgnore: ['dist/**'],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig
