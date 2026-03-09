import type { SshTunnelConfig } from '@dotaz/shared/types/connection'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SSH_CONNECT_TIMEOUT_MS = 15_000
const PORT_CHECK_INTERVAL_MS = 100

export interface SshTunnel {
	localPort: number
	close(): Promise<void>
}

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			if (addr && typeof addr !== 'string') {
				const port = addr.port
				server.close(() => resolve(port))
			} else {
				server.close(() => reject(new Error('Could not find a free port')))
			}
		})
		server.on('error', reject)
	})
}

async function waitForPort(port: number, timeoutMs: number, proc?: ChildProcess): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (proc && proc.exitCode !== null) return

		try {
			await new Promise<void>((resolve, reject) => {
				const socket = createConnection({ host: '127.0.0.1', port }, () => {
					socket.end()
					resolve()
				})
				socket.on('error', reject)
				socket.setTimeout(1000, () => {
					socket.destroy()
					reject(new Error('timeout'))
				})
			})
			return
		} catch {
			await new Promise((r) => setTimeout(r, PORT_CHECK_INTERVAL_MS))
		}
	}
	throw new Error(`SSH tunnel port ${port} did not become available within ${timeoutMs / 1000}s`)
}

export async function createSshTunnel(
	config: SshTunnelConfig,
	remoteHost: string,
	remotePort: number,
): Promise<SshTunnel> {
	const localPort = config.localPort || await findFreePort()
	let askPassPath: string | null = null
	let proc: ChildProcess | null = null

	try {
		const args = [
			'-N',
			'-L',
			`${localPort}:${remoteHost}:${remotePort}`,
			'-p',
			String(config.port || 22),
			'-o',
			'StrictHostKeyChecking=accept-new',
			'-o',
			'ServerAliveInterval=30',
			'-o',
			'ExitOnForwardFailure=yes',
		]

		const env: Record<string, string> = { ...process.env } as Record<string, string>

		if (config.authMethod === 'key' && config.keyPath) {
			args.push('-i', config.keyPath)
			args.push('-o', 'BatchMode=yes')
		} else if (config.password) {
			askPassPath = join(tmpdir(), `dotaz-askpass-${process.pid}-${Date.now()}`)
			writeFileSync(askPassPath, `#!/bin/sh\necho '${config.password.replace(/'/g, "'\\''")}'`)
			chmodSync(askPassPath, 0o700)
			env.SSH_ASKPASS = askPassPath
			env.SSH_ASKPASS_REQUIRE = 'force'
			env.DISPLAY = env.DISPLAY || ':0'
		}

		args.push(`${config.username}@${config.host}`)

		proc = spawn('ssh', args, {
			stdio: ['pipe', 'ignore', 'pipe'],
			env,
		})

		// Close stdin to prevent ssh from waiting for input
		if (proc.stdin) {
			proc.stdin.end()
		}

		// Collect stderr
		let stderrData = ''
		if (proc.stderr) {
			proc.stderr.on('data', (chunk: Buffer) => {
				stderrData += chunk.toString('utf-8')
			})
		}

		const portReady = waitForPort(localPort, SSH_CONNECT_TIMEOUT_MS, proc)
		const processExited = new Promise<void>((_, reject) => {
			proc!.on('exit', (exitCode) => {
				if (exitCode !== 0) {
					const errorMsg = parseSshError(stderrData) || `SSH process exited with code ${exitCode}`
					reject(new Error(errorMsg))
				}
			})
		})

		await Promise.race([portReady, processExited])

		const tunnel: SshTunnel = {
			localPort,
			close: async () => {
				if (proc) {
					proc.kill()
					proc = null
				}
				cleanupAskPass(askPassPath)
			},
		}

		return tunnel
	} catch (err) {
		if (proc) {
			proc.kill()
		}
		cleanupAskPass(askPassPath)

		if (err instanceof Error) throw mapSshError(err)
		throw new Error(`SSH tunnel error: ${String(err)}`)
	}
}

function cleanupAskPass(path: string | null): void {
	if (path) {
		try {
			unlinkSync(path)
		} catch { /* ignore */ }
	}
}

function parseSshError(stderr: string): string | null {
	if (!stderr.trim()) return null
	const lines = stderr.trim().split('\n')
	for (const line of lines) {
		const lower = line.toLowerCase()
		if (lower.includes('permission denied') || lower.includes('authentication')) {
			return `SSH authentication failed: ${line.trim()}`
		}
		if (lower.includes('connection refused')) {
			return `SSH host unreachable: ${line.trim()}`
		}
		if (lower.includes('timed out') || lower.includes('timeout')) {
			return `SSH connection timed out: ${line.trim()}`
		}
		if (lower.includes('no such file') || lower.includes('no such identity')) {
			return `SSH key file not found: ${line.trim()}`
		}
		if (lower.includes('could not resolve')) {
			return `SSH host unreachable: ${line.trim()}`
		}
	}
	return lines[lines.length - 1]?.trim() || null
}

function mapSshError(err: Error): Error {
	const msg = err.message.toLowerCase()
	if (msg.includes('authentication') || msg.includes('permission denied')) {
		return new Error(`SSH authentication failed: ${err.message}`)
	}
	if (msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('unreachable')) {
		return new Error(`SSH host unreachable: ${err.message}`)
	}
	if (msg.includes('timeout') || msg.includes('timed out')) {
		return new Error(`SSH connection timed out: ${err.message}`)
	}
	return new Error(`SSH tunnel error: ${err.message}`)
}
