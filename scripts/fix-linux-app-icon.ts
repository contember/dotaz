// electrobun postBuild hook: place the app icon where the Linux launcher looks for it.
// electrobun 2.0.1 loads "Resources/appIcon.png" relative to the launcher cwd, which it
// forces to <app>/bin, so the real <app>/Resources copy is never found and no icon is set.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const buildDir = process.env.ELECTROBUN_BUILD_DIR

if (process.env.ELECTROBUN_OS === 'linux' && buildDir && existsSync(buildDir)) {
	for (const entry of readdirSync(buildDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue
		}

		const appDir = join(buildDir, entry.name)
		const icon = join(appDir, 'Resources', 'appIcon.png')
		const binDir = join(appDir, 'bin')

		if (!existsSync(icon) || !existsSync(binDir)) {
			continue
		}

		mkdirSync(join(binDir, 'Resources'), { recursive: true })
		copyFileSync(icon, join(binDir, 'Resources', 'appIcon.png'))
		console.log(`[icon] mirrored appIcon.png into ${entry.name}/bin/Resources`)
	}
}
