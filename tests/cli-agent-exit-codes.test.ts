import type { ProposalStatus } from '@dotaz/shared/types/rpc'
import { describe, expect, test } from 'bun:test'
import { RpcError } from '../src/cli-agent/client'
import { CliError, databaseError, EXIT, type ExitCode, notRunningError, readOnlyError, timeoutError, usageError } from '../src/cli-agent/errors'
import { exitCodeForProposal, proposalNote } from '../src/cli-agent/proposals'

describe('exit code constants', () => {
	test('match the documented contract', () => {
		expect(EXIT.ok).toBe(0)
		expect(EXIT.usage).toBe(2)
		expect(EXIT.database).toBe(3)
		expect(EXIT.readOnly).toBe(4)
		expect(EXIT.notRunning).toBe(5)
		expect(EXIT.timeout).toBe(6)
		expect(EXIT.pending).toBe(7)
		expect(EXIT.rejected).toBe(8)
	})
})

describe('error constructors', () => {
	test('carry the right exit code', () => {
		expect(usageError('x').exitCode).toBe(EXIT.usage)
		expect(databaseError('x').exitCode).toBe(EXIT.database)
		expect(readOnlyError('x').exitCode).toBe(EXIT.readOnly)
		expect(notRunningError('x').exitCode).toBe(EXIT.notRunning)
		expect(timeoutError('x').exitCode).toBe(EXIT.timeout)
	})

	test('a read-only violation always points at dotaz propose', () => {
		expect(readOnlyError('nope').hint).toContain('dotaz propose')
	})

	test('"not running" tells the user how to turn CLI access on', () => {
		const err = notRunningError('nothing here')
		expect(err.hint).toContain('Start Dotaz')
		expect(err.hint).toContain('Allow CLI access')
	})

	test('an RPC failure defaults to the database exit code', () => {
		const err = new RpcError({ message: 'boom', errorCode: 'QUERY_SYNTAX' })
		expect(err instanceof CliError).toBe(true)
		expect(err.exitCode).toBe(EXIT.database)
		expect(err.errorCode).toBe('QUERY_SYNTAX')
	})
})

describe('exitCodeForProposal', () => {
	const cases: [ProposalStatus, ExitCode][] = [
		['executed', EXIT.ok],
		['failed', EXIT.database],
		['rejected', EXIT.rejected],
		['cancelled', EXIT.rejected],
		['pending', EXIT.pending],
		['approved', EXIT.pending],
		['expired', EXIT.pending],
	]

	for (const [status, expected] of cases) {
		test(`${status} → ${expected}`, () => {
			expect(exitCodeForProposal(status)).toBe(expected)
		})
	}

	test('every status has a human-readable note', () => {
		for (const [status] of cases) {
			expect(proposalNote({ id: 'p1', connectionId: 'c1', sql: 'UPDATE t SET a=1', status, createdAt: 0 }).length).toBeGreaterThan(0)
		}
	})
})
