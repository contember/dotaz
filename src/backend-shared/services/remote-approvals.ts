// Remote approvals: approve or reject an agent's write proposal with a passkey from a paired
// device (docs/agent-cli.md, "Remote approvals").
//
// The CLI endpoint's token is readable by every process of the user's account, so nothing here
// trusts the caller. A decision counts only with a WebAuthn assertion, made with user
// verification by a key the user paired in the app's own window, over a challenge this module
// recomputes from its own nonce and its own stored proposal. Pairing a key is only possible
// from the app's window: the CLI can ask, never add.

import {
	approvalChallengeBytes,
	approverFingerprint,
	base64UrlToBytes,
	bytesToBase64Url,
	isSafeLabel,
	remoteApprovalRefusal,
	sqlSha256,
} from '@dotaz/shared/remote-approval'
import { splitStatements } from '@dotaz/shared/sql/statements'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type {
	ApprovalChallenge,
	ApprovalChallengeParams,
	ApprovalRedeemParams,
	ApproverRequest,
	ApproverRequestParams,
	ApproverRequestResult,
	ApproversState,
	Proposal,
	RemoteApprover,
} from '@dotaz/shared/types/rpc'
import type { StoredApprover } from '../storage/app-db'
import type { ProposalStore } from './proposal-store'
import { parseCoseEs256, verifyAssertion, WebAuthnError } from './webauthn'

/** A challenge is good for this long, and for one redeem attempt. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000
/**
 * Unredeemed, unexpired challenges allowed per proposal. Per proposal rather than global, so a
 * caller flooding one proposal cannot keep the user from approving another.
 */
export const MAX_CHALLENGES_PER_PROPOSAL = 4
/** A pairing request waits this long for the user. */
export const PAIRING_TTL_MS = 5 * 60 * 1000
/** A pairing code shown in the window is good for this long, and for one request. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000
/** Wrong codes allowed before the window's code is withdrawn. */
export const PAIRING_CODE_ATTEMPTS = 5
export const PAIRING_CODE_DIGITS = 6
export const MAX_APPROVERS = 20
export const MAX_APPROVER_LABEL_LENGTH = 64

const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

export interface ApproverStorage {
	listRemoteApprovers(): StoredApprover[]
	addRemoteApprover(approver: StoredApprover): void
	removeRemoteApprover(id: string): boolean
}

export interface RemoteApprovalsOptions {
	storage: ApproverStorage
	proposals: ProposalStore
	/** Why the proposal's connection cannot take a write right now, or null when it can. */
	connectionBlock: (proposal: Proposal) => string | null
	/**
	 * Run the proposal's frozen SQL in a read-write session created for this run only.
	 * Returns the counts, never rows. Throws on failure.
	 */
	execute: (proposal: Proposal) => Promise<{ affectedRows: number; statements: number }>
	/** Pairing request or approver list changed: the app's window shows both. */
	onChange?: (state: ApproversState) => void
	now?: () => number
}

interface IssuedChallenge {
	proposalId: string
	decision: 'approve' | 'reject'
	expiresAt: number
}

interface PendingPairing extends ApproverRequest {
	publicKey: string
}

function refused(message: string): DatabaseError {
	return new DatabaseError('APPROVAL_REFUSED', message)
}

function pairingRefused(message: string): DatabaseError {
	return new DatabaseError('PAIRING_REFUSED', message)
}

function decode(value: string, field: string): Uint8Array {
	try {
		return base64UrlToBytes(value)
	} catch {
		throw refused(`${field} is not base64url`)
	}
}

/** Constant-time comparison of two short strings. */
function sameText(a: string, b: string): boolean {
	if (typeof a !== 'string' || a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}

function publicApprover(approver: StoredApprover): RemoteApprover {
	const { publicKey: _publicKey, ...rest } = approver
	return rest
}

/**
 * A relying party only a remote server can hold. Any program on this machine can open a port on
 * localhost and serve a page there, so a key paired for localhost or a loopback address could be
 * asked to sign by a page the user did not mean to trust. IP literals are not valid RP ids anyway.
 */
function isRemoteRpId(rpId: string): boolean {
	if (rpId === 'localhost' || rpId.endsWith('.localhost')) return false
	if (/^[0-9.]+$/.test(rpId)) return false
	return rpId.includes('.')
}

/** https only, and WebAuthn's rule: the origin's host is the RP id or a subdomain of it. */
function originMatchesRpId(origin: string, rpId: string): boolean {
	let url: URL
	try {
		url = new URL(origin)
	} catch {
		return false
	}
	if (url.origin !== origin || url.protocol !== 'https:') return false
	return url.hostname === rpId || url.hostname.endsWith(`.${rpId}`)
}

export class RemoteApprovals {
	private readonly storage: ApproverStorage
	private readonly proposals: ProposalStore
	private readonly connectionBlock: (proposal: Proposal) => string | null
	private readonly execute: (proposal: Proposal) => Promise<{ affectedRows: number; statements: number }>
	private readonly onChange?: (state: ApproversState) => void
	private readonly now: () => number
	private challenges = new Map<string, IssuedChallenge>()
	private pairing: PendingPairing | null = null
	private pairingTimer: ReturnType<typeof setTimeout> | null = null
	/** The code the window shows after "Pair a device"; a request without it is refused. */
	private armed: { code: string; expiresAt: number; wrongAttempts: number } | null = null

	constructor(opts: RemoteApprovalsOptions) {
		this.storage = opts.storage
		this.proposals = opts.proposals
		this.connectionBlock = opts.connectionBlock
		this.execute = opts.execute
		this.onChange = opts.onChange
		this.now = opts.now ?? (() => Date.now())
	}

	// ── Approver keys ────────────────────────────────────

	listApprovers(): RemoteApprover[] {
		return this.storage.listRemoteApprovers().map(publicApprover)
	}

	/** App window only: includes the pairing code, which must never reach the CLI. */
	state(): ApproversState {
		const armed = this.armedCode()
		return {
			request: this.pendingRequest(),
			approvers: this.listApprovers(),
			armed: armed ? { code: armed.code, expiresAt: armed.expiresAt } : null,
		}
	}

	/**
	 * App window only: the user clicked "Pair a device". Shows a one-time code the device must
	 * send with its request, so a process that cannot see the screen cannot even ask.
	 */
	armPairing(): { code: string; expiresAt: number } {
		let value: number
		const limit = 10 ** PAIRING_CODE_DIGITS
		// Rejection sampling keeps every code equally likely.
		const ceiling = Math.floor(0x1_0000_0000 / limit) * limit
		do {
			value = crypto.getRandomValues(new Uint32Array(1))[0]
		} while (value >= ceiling)
		const code = String(value % limit).padStart(PAIRING_CODE_DIGITS, '0')
		this.armed = { code, expiresAt: this.now() + PAIRING_CODE_TTL_MS, wrongAttempts: 0 }
		this.emit()
		return { code, expiresAt: this.armed.expiresAt }
	}

	/** App window only. */
	disarmPairing(): void {
		if (!this.armed) return
		this.armed = null
		this.emit()
	}

	/**
	 * CLI: ask to pair a key, with the code the window shows. The user then still confirms the
	 * request, with its fingerprint, in the window.
	 */
	async requestApprover(params: ApproverRequestParams): Promise<ApproverRequestResult> {
		const now = this.now()
		this.sweepPairing()
		if (this.pairing) throw pairingRefused('A pairing request is already waiting for the user.')
		if (!this.armedCode()) {
			throw pairingRefused('Pairing is not open. In Dotaz, choose Settings > CLI > Pair a device and send the code it shows.')
		}

		const label = params.label.trim()
		if (!isSafeLabel(label, MAX_APPROVER_LABEL_LENGTH)) {
			throw pairingRefused(`label must be 1 to ${MAX_APPROVER_LABEL_LENGTH} printable characters on one line`)
		}
		if (!RP_ID.test(params.rpId) || !isRemoteRpId(params.rpId)) {
			throw pairingRefused('rpId must be a lowercase domain name, not localhost or an IP address')
		}
		if (!originMatchesRpId(params.origin, params.rpId)) {
			throw pairingRefused('origin must be an https origin on rpId or a subdomain of it')
		}
		let credentialId: Uint8Array
		try {
			credentialId = base64UrlToBytes(params.credentialId)
			parseCoseEs256(base64UrlToBytes(params.publicKey))
		} catch (err) {
			throw pairingRefused(`Invalid key: ${err instanceof Error ? err.message : String(err)}`)
		}
		if (credentialId.length < 16 || credentialId.length > 1023) throw pairingRefused('credentialId must be 16 to 1023 bytes')

		const approvers = this.storage.listRemoteApprovers()
		if (approvers.some((a) => a.credentialId === params.credentialId)) throw pairingRefused('This key is already paired')
		if (approvers.length >= MAX_APPROVERS) throw pairingRefused(`At most ${MAX_APPROVERS} keys can be paired. Remove one in the app first.`)

		const fingerprint = await approverFingerprint(params.credentialId, params.publicKey)
		// Checked after the await, with nothing async after it: the code is consumed atomically.
		if (this.pairing) throw pairingRefused('A pairing request is already waiting for the user.')
		this.consumeCode(params.pairingCode)

		this.pairing = {
			requestId: crypto.randomUUID(),
			label,
			rpId: params.rpId,
			origin: params.origin,
			credentialId: params.credentialId,
			publicKey: params.publicKey,
			fingerprint,
			requestedAt: now,
			expiresAt: now + PAIRING_TTL_MS,
		}
		this.schedulePairingExpiry()
		this.emit()
		return { requestId: this.pairing.requestId, fingerprint, expiresAt: this.pairing.expiresAt }
	}

	/** The request waiting for the user, if any. Never includes the public key. */
	pendingRequest(): ApproverRequest | null {
		this.sweepPairing()
		if (!this.pairing) return null
		const { publicKey: _publicKey, ...request } = this.pairing
		return request
	}

	/**
	 * App window only: the user compared the fingerprint and clicked Add. The fingerprint the
	 * window showed must still be the one waiting, so a swapped request cannot ride the click.
	 */
	confirmRequest(requestId: string, fingerprint: string): RemoteApprover {
		this.sweepPairing()
		const pairing = this.pairing
		if (!pairing || pairing.requestId !== requestId || pairing.fingerprint !== fingerprint) {
			throw pairingRefused('This pairing request is no longer waiting')
		}
		this.clearPairing()
		const approvers = this.storage.listRemoteApprovers()
		if (approvers.some((a) => a.credentialId === pairing.credentialId)) {
			this.emit()
			throw pairingRefused('This key is already paired')
		}
		const approver: StoredApprover = {
			id: crypto.randomUUID(),
			label: pairing.label,
			rpId: pairing.rpId,
			origin: pairing.origin,
			credentialId: pairing.credentialId,
			publicKey: pairing.publicKey,
			fingerprint: pairing.fingerprint,
			addedAt: this.now(),
		}
		this.storage.addRemoteApprover(approver)
		this.emit()
		return publicApprover(approver)
	}

	/** App window only. */
	declineRequest(requestId: string): void {
		this.sweepPairing()
		if (!this.pairing || this.pairing.requestId !== requestId) return
		this.clearPairing()
		this.emit()
	}

	/** App window only. */
	removeApprover(id: string): void {
		if (!this.storage.removeRemoteApprover(id)) throw new Error(`Approver not found: ${id}`)
		this.emit()
	}

	// ── Decisions ────────────────────────────────────────

	/** Anyone may ask: a challenge by itself does nothing. */
	async challenge(params: ApprovalChallengeParams): Promise<ApprovalChallenge> {
		const approvers = this.storage.listRemoteApprovers()
		if (approvers.length === 0) {
			throw new DatabaseError('APPROVAL_UNAVAILABLE', 'No approver keys are paired with this app. Approve the proposal in the Dotaz window.')
		}
		const proposal = this.requirePending(params.proposalId)
		if (params.decision === 'approve') this.assertRunnable(proposal)

		const now = this.now()
		this.sweepChallenges(now)
		const forProposal = [...this.challenges.values()].filter((c) => c.proposalId === proposal.id).length
		if (forProposal >= MAX_CHALLENGES_PER_PROPOSAL) {
			throw refused('Too many approval challenges are outstanding for this proposal. Try again in a few minutes.')
		}
		const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
		const expiresAt = now + CHALLENGE_TTL_MS
		this.challenges.set(nonce, { proposalId: proposal.id, decision: params.decision, expiresAt })

		return {
			nonce,
			expiresAt,
			proposal: {
				id: proposal.id,
				connectionId: proposal.connectionId,
				connectionName: proposal.connectionName,
				database: proposal.database ?? null,
				sql: proposal.sql,
				sqlSha256: await sqlSha256(proposal.sql),
				reason: proposal.reason ?? null,
				requestedBy: proposal.requestedBy ?? null,
				createdAt: proposal.createdAt,
				statements: splitStatements(proposal.sql).length,
			},
			allowCredentials: approvers.map((a) => a.credentialId),
		}
	}

	/**
	 * Act on a signed decision. The signature is the proof, not the caller: the nonce must be
	 * this app's own, unused, unexpired and issued for this proposal and decision, and the
	 * assertion must verify over bytes recomputed from the stored proposal.
	 */
	async redeem(params: ApprovalRedeemParams): Promise<Proposal> {
		// One attempt per nonce, good or bad: take it out before looking at anything else.
		const issued = this.challenges.get(params.nonce)
		this.challenges.delete(params.nonce)
		if (!issued) throw refused('Unknown or already used challenge. Request a new one.')
		if (issued.expiresAt <= this.now()) throw refused('The challenge expired. Request a new one.')
		if (issued.proposalId !== params.proposalId || issued.decision !== params.decision) {
			throw refused('The challenge was issued for another proposal or decision')
		}

		const approver = this.storage.listRemoteApprovers().find((a) => a.credentialId === params.credentialId)
		if (!approver) throw refused('The key that signed is not paired with this app')

		const proposal = this.requirePending(params.proposalId)
		const expectedChallenge = await approvalChallengeBytes(params.nonce, params.decision, proposal)
		try {
			verifyAssertion({
				publicKey: base64UrlToBytes(approver.publicKey),
				rpId: approver.rpId,
				origin: approver.origin,
				expectedChallenge,
				authenticatorData: decode(params.authenticatorData, 'authenticatorData'),
				clientDataJSON: decode(params.clientDataJSON, 'clientDataJSON'),
				signature: decode(params.signature, 'signature'),
			})
		} catch (err) {
			if (err instanceof WebAuthnError) throw refused(`The approval does not verify: ${err.message}`)
			throw err
		}

		if (params.decision === 'reject') {
			return this.claim(() => this.proposals.rejectRemote(proposal.id, approver.label))
		}

		this.assertRunnable(proposal)
		// Atomic `pending → approved`: from here a click in the app's window can no longer run it.
		this.claim(() => this.proposals.claimRemote(proposal.id, approver.label))
		try {
			const result = await this.execute(proposal)
			return this.proposals.settleRemote(proposal.id, 'executed', result)
		} catch (err) {
			return this.proposals.settleRemote(proposal.id, 'failed', undefined, err instanceof Error ? err.message : String(err))
		}
	}

	dispose(): void {
		this.clearPairing()
		this.challenges.clear()
	}

	// ── Internals ────────────────────────────────────────

	private requirePending(proposalId: string): Proposal {
		const proposal = this.proposals.get(proposalId)
		if (!proposal) throw refused(`Proposal not found: ${proposalId}`)
		if (proposal.status !== 'pending') throw refused(`Proposal ${proposalId} is already ${proposal.status}`)
		return proposal
	}

	private assertRunnable(proposal: Proposal): void {
		const refusal = remoteApprovalRefusal(proposal) ?? this.connectionBlock(proposal)
		if (refusal) throw refused(refusal)
	}

	private claim(transition: () => Proposal): Proposal {
		try {
			return transition()
		} catch (err) {
			throw refused(err instanceof Error ? err.message : String(err))
		}
	}

	private sweepChallenges(now: number): void {
		for (const [nonce, issued] of this.challenges) {
			if (issued.expiresAt <= now) this.challenges.delete(nonce)
		}
	}

	private armedCode(): { code: string; expiresAt: number; wrongAttempts: number } | null {
		if (this.armed && this.armed.expiresAt <= this.now()) this.armed = null
		return this.armed
	}

	/** One request per code. Too many wrong codes withdraw it; the user can show a new one. */
	private consumeCode(code: string): void {
		const armed = this.armedCode()
		if (!armed) throw pairingRefused('Pairing is not open. In Dotaz, choose Settings > CLI > Pair a device.')
		if (!sameText(code, armed.code)) {
			armed.wrongAttempts++
			if (armed.wrongAttempts >= PAIRING_CODE_ATTEMPTS) {
				this.armed = null
				this.emit()
				throw pairingRefused('Wrong pairing code too many times. Show a new code in Dotaz.')
			}
			throw pairingRefused('Wrong pairing code.')
		}
		this.armed = null
	}

	private sweepPairing(): void {
		if (this.pairing && this.pairing.expiresAt <= this.now()) {
			this.clearPairing()
			this.emit()
		}
	}

	private schedulePairingExpiry(): void {
		if (!this.pairing) return
		const delay = Math.max(0, this.pairing.expiresAt - this.now()) + 50
		this.pairingTimer = setTimeout(() => {
			this.pairingTimer = null
			this.sweepPairing()
		}, delay)
		// Never keep the process alive just to expire a request.
		this.pairingTimer.unref()
	}

	private clearPairing(): void {
		this.pairing = null
		if (this.pairingTimer !== null) clearTimeout(this.pairingTimer)
		this.pairingTimer = null
	}

	private emit(): void {
		this.onChange?.(this.state())
	}
}
