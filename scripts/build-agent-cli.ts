// Build the dependency-free @dotaz/cli package published by the release workflow.

import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import rootPkg from '../package.json'

const ROOT = resolve(import.meta.dir, '..')
const OUT = resolve(ROOT, 'dist-agent-cli')
const VERSION = process.env.VERSION || rootPkg.version

rmSync(OUT, { recursive: true, force: true })
mkdirSync(resolve(OUT, 'bin'), { recursive: true })

const build = await Bun.build({
	entrypoints: [resolve(ROOT, 'src/cli-agent/main.ts')],
	outdir: resolve(OUT, 'bin'),
	target: 'bun',
	minify: true,
	naming: 'dotaz.js',
	define: {
		__DOTAZ_CLI_VERSION__: JSON.stringify(VERSION),
	},
})

if (!build.success) {
	for (const log of build.logs) console.error(log)
	throw new Error('Failed to bundle @dotaz/cli')
}

const packageJson = {
	name: '@dotaz/cli',
	version: VERSION,
	description: 'Agent CLI for the running Dotaz desktop database client',
	type: 'module',
	license: rootPkg.license,
	author: rootPkg.author,
	repository: {
		type: 'git',
		url: 'git+https://github.com/contember/dotaz.git',
		directory: 'src/cli-agent',
	},
	homepage: 'https://github.com/contember/dotaz#agent-cli',
	bugs: 'https://github.com/contember/dotaz/issues',
	keywords: ['database', 'cli', 'agent', 'postgresql', 'mysql', 'sqlite'],
	bin: { dotaz: 'bin/dotaz.js' },
	files: ['bin/', 'README.md', 'LICENSE'],
	engines: { bun: '>=1.3.0' },
	publishConfig: { access: 'public' },
}

await Promise.all([
	Bun.write(resolve(OUT, 'package.json'), `${JSON.stringify(packageJson, null, '\t')}\n`),
	Bun.write(resolve(OUT, 'README.md'), Bun.file(resolve(ROOT, 'src/cli-agent/README.md'))),
	Bun.write(resolve(OUT, 'LICENSE'), Bun.file(resolve(ROOT, 'LICENSE'))),
])

chmodSync(resolve(OUT, 'bin/dotaz.js'), 0o755)
console.log(`Agent CLI package ${VERSION} built at ${OUT}`)
