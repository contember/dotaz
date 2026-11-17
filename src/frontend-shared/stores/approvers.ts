// Remote approvals: keys allowed to approve agent proposals from a paired device, and the
// pairing request waiting for the user (see docs/agent-cli.md). Adding and removing a key only
// ever happens here, in the app's own window.

import type { ApproverRequest, ApproversState, RemoteApprover } from '@dotaz/shared/types/rpc'
import { createStore, reconcile } from 'solid-js/store'
import { friendlyErrorMessage, rpc } from '../lib/rpc'
import { uiStore } from './ui'

const [state, setState] = createStore<ApproversState>({ request: null, approvers: [], armed: null })

function apply(next: ApproversState) {
	setState('request', next.request)
	setState('armed', next.armed)
	setState('approvers', reconcile(next.approvers))
}

/** Load the current state once the transport is up. Desktop only: other modes have no CLI. */
async function load() {
	try {
		apply(await rpc.approvers.state())
	} catch (err) {
		console.debug('Remote approvals unavailable:', err)
	}
}

/** "Pair a device": show a one-time code the device must send with its request. */
async function openPairing() {
	try {
		await rpc.approvers.arm()
	} catch (err) {
		uiStore.addToast('error', friendlyErrorMessage(err))
	} finally {
		await load()
	}
}

async function cancelPairing() {
	try {
		await rpc.approvers.disarm()
	} finally {
		await load()
	}
}

/** The user compared the fingerprint and accepts the key. */
async function confirm(request: ApproverRequest) {
	try {
		const approver = await rpc.approvers.confirm({ requestId: request.requestId, fingerprint: request.fingerprint })
		uiStore.addToast('success', `Key "${approver.label}" can now approve agent proposals.`)
	} catch (err) {
		uiStore.addToast('error', friendlyErrorMessage(err))
	} finally {
		await load()
	}
}

async function decline(request: ApproverRequest) {
	try {
		await rpc.approvers.decline({ requestId: request.requestId })
	} finally {
		await load()
	}
}

async function remove(approver: RemoteApprover) {
	const confirmed = await uiStore.confirm({
		title: 'Remove approver key',
		message: `"${approver.label}" (${approver.origin}) will no longer be able to approve proposals.`,
		confirmLabel: 'Remove',
		danger: true,
	})
	if (!confirmed) return
	try {
		await rpc.approvers.remove({ id: approver.id })
	} catch (err) {
		uiStore.addToast('error', friendlyErrorMessage(err))
	} finally {
		await load()
	}
}

export const approversStore = {
	get request() {
		return state.request
	},
	get approvers() {
		return state.approvers
	},
	get armed() {
		return state.armed
	},
	apply,
	load,
	openPairing,
	cancelPairing,
	confirm,
	decline,
	remove,
}
