import { decodeAgentHello } from '../decode'
import type { Command } from './types'

export const statusCommand: Command = {
	name: 'status',
	flags: {},
	help: {
		usage: 'status',
		summary: 'report whether Dotaz is running with CLI access enabled',
		notes: ['Exit code 5 means Dotaz is not running or CLI access is off.'],
	},
	async run(ctx) {
		const health = await ctx.client.health()
		const hello = decodeAgentHello(await ctx.client.call('agent.hello'))
		const connections = await ctx.app.listConnections()
		const connected = connections.filter((c) => c.state === 'connected').length
		const { endpoint, file } = ctx.endpoint

		const row = {
			status: 'running',
			version: hello.version || health.version,
			mode: hello.mode,
			pid: hello.pid || health.pid,
			protocol: hello.protocol,
			transport: endpoint.transport === 'unix' ? `unix ${endpoint.socket}` : `tcp 127.0.0.1:${endpoint.port}`,
			endpoint: file,
			connections: connections.length,
			connected,
		}

		return {
			output: {
				sections: [{ kind: 'kv', columns: Object.keys(row).map((name) => ({ name })), rows: [row] }],
				json: row,
			},
		}
	},
}
