import { Subprocess } from "bun";
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SshTunnelConfig } from "../../shared/types/connection";

const SSH_CONNECT_TIMEOUT_MS = 15_000;
const PORT_CHECK_INTERVAL_MS = 100;

export interface SshTunnel {
	/** The local port the tunnel is listening on. */
	localPort: number;
	/** Close the tunnel and clean up all resources. */
	close(): Promise<void>;
}

/**
 * Find a free local port by briefly opening a TCP listener on port 0.
 */
async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: {
				data() {},
				open() {},
				close() {},
				error() {},
			},
		});
		const port = server.port;
		server.stop(true);
		if (port > 0) {
			resolve(port);
		} else {
			reject(new Error("Could not find a free port"));
		}
	});
}

/**
 * Wait until a TCP connection to the given port succeeds,
 * indicating the SSH tunnel is forwarding.
 */
async function waitForPort(port: number, timeoutMs: number, proc?: Subprocess): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		// Bail early if the ssh process has exited
		if (proc && proc.exitCode !== null) return;

		try {
			const socket = await Bun.connect({
				hostname: "127.0.0.1",
				port,
				socket: {
					data() {},
					open(socket) { socket.end(); },
					close() {},
					error() {},
				},
			});
			// Connection succeeded — tunnel is ready
			socket.end();
			return;
		} catch {
			// Not ready yet
			await Bun.sleep(PORT_CHECK_INTERVAL_MS);
		}
	}
	throw new Error(`SSH tunnel port ${port} did not become available within ${timeoutMs / 1000}s`);
}

/**
 * Create an SSH tunnel that forwards a local port to a remote host:port
 * through an SSH bastion/jump server using the system `ssh` command.
 *
 * Returns an SshTunnel object with the local port and a close() method.
 */
export async function createSshTunnel(
	config: SshTunnelConfig,
	remoteHost: string,
	remotePort: number,
): Promise<SshTunnel> {
	const localPort = config.localPort || await findFreePort();
	let askPassPath: string | null = null;
	let proc: Subprocess | null = null;

	try {
		const args = [
			"ssh",
			"-N",                              // No remote command
			"-L", `${localPort}:${remoteHost}:${remotePort}`,
			"-p", String(config.port || 22),
			"-o", "StrictHostKeyChecking=accept-new",
			"-o", "ServerAliveInterval=30",
			"-o", "ExitOnForwardFailure=yes",
		];

		const env: Record<string, string> = { ...process.env } as Record<string, string>;

		if (config.authMethod === "key" && config.keyPath) {
			args.push("-i", config.keyPath);
			args.push("-o", "BatchMode=yes");    // No interactive prompts
		} else if (config.password) {
			// Use SSH_ASKPASS to provide the password non-interactively
			askPassPath = join(tmpdir(), `dotaz-askpass-${process.pid}-${Date.now()}`);
			writeFileSync(askPassPath, `#!/bin/sh\necho '${config.password.replace(/'/g, "'\\''")}'`);
			chmodSync(askPassPath, 0o700);
			env.SSH_ASKPASS = askPassPath;
			env.SSH_ASKPASS_REQUIRE = "force";
			// Ensure no tty so SSH uses ASKPASS
			env.DISPLAY = env.DISPLAY || ":0";
		}

		args.push(`${config.username}@${config.host}`);

		proc = Bun.spawn(args, {
			stdin: "pipe",
			stdout: "ignore",
			stderr: "pipe",
			env,
		});

		// Close stdin to prevent ssh from waiting for input
		if (proc.stdin && typeof proc.stdin !== "number") {
			(proc.stdin as import("bun").FileSink).end();
		}

		// Race: wait for port to become available OR ssh process to exit
		const stderrStream = proc.stderr && typeof proc.stderr !== "number"
			? proc.stderr as ReadableStream<Uint8Array>
			: null;

		const portReady = waitForPort(localPort, SSH_CONNECT_TIMEOUT_MS, proc);
		const processExited = proc.exited.then(async (exitCode) => {
			if (exitCode !== 0) {
				const stderr = await readStream(stderrStream);
				const errorMsg = parseSshError(stderr) || `SSH process exited with code ${exitCode}`;
				throw new Error(errorMsg);
			}
		});

		// Wait for either port ready (success) or process exit (error)
		await Promise.race([portReady, processExited]);

		const tunnel: SshTunnel = {
			localPort,
			close: async () => {
				if (proc) {
					proc.kill();
					proc = null;
				}
				cleanupAskPass(askPassPath);
			},
		};

		return tunnel;
	} catch (err) {
		// Cleanup on failure
		if (proc) {
			proc.kill();
		}
		cleanupAskPass(askPassPath);

		if (err instanceof Error) throw mapSshError(err);
		throw new Error(`SSH tunnel error: ${String(err)}`);
	}
}

function cleanupAskPass(path: string | null): void {
	if (path) {
		try { unlinkSync(path); } catch { /* ignore */ }
	}
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
	if (!stream) return "";
	try {
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf-8");
	} catch {
		return "";
	}
}

function parseSshError(stderr: string): string | null {
	if (!stderr.trim()) return null;
	// Extract the most meaningful line from ssh stderr
	const lines = stderr.trim().split("\n");
	for (const line of lines) {
		const lower = line.toLowerCase();
		if (lower.includes("permission denied") || lower.includes("authentication")) {
			return `SSH authentication failed: ${line.trim()}`;
		}
		if (lower.includes("connection refused")) {
			return `SSH host unreachable: ${line.trim()}`;
		}
		if (lower.includes("timed out") || lower.includes("timeout")) {
			return `SSH connection timed out: ${line.trim()}`;
		}
		if (lower.includes("no such file") || lower.includes("no such identity")) {
			return `SSH key file not found: ${line.trim()}`;
		}
		if (lower.includes("could not resolve")) {
			return `SSH host unreachable: ${line.trim()}`;
		}
	}
	// Return the last non-empty line
	return lines[lines.length - 1]?.trim() || null;
}

function mapSshError(err: Error): Error {
	const msg = err.message.toLowerCase();
	if (msg.includes("authentication") || msg.includes("permission denied")) {
		return new Error(`SSH authentication failed: ${err.message}`);
	}
	if (msg.includes("econnrefused") || msg.includes("connection refused") || msg.includes("unreachable")) {
		return new Error(`SSH host unreachable: ${err.message}`);
	}
	if (msg.includes("timeout") || msg.includes("timed out")) {
		return new Error(`SSH connection timed out: ${err.message}`);
	}
	return new Error(`SSH tunnel error: ${err.message}`);
}
