// Minimal WebAuthn assertion verifier: ES256 (ECDSA P-256 + SHA-256) only, no dependencies.
// Used by remote approvals (docs/agent-cli.md). Every check here fails closed.

import { base64UrlToBytes } from '@dotaz/shared/remote-approval'
import { createHash, createPublicKey, type KeyObject, timingSafeEqual, verify } from 'node:crypto'

export class WebAuthnError extends Error {}

// ── COSE key (RFC 9053 / 8152) ───────────────────────────

/** COSE_Key labels and values for an EC2 P-256 ES256 key. */
const COSE_KTY = 1
const COSE_ALG = 3
const COSE_CRV = -1
const COSE_X = -2
const COSE_Y = -3
const KTY_EC2 = 2
const ALG_ES256 = -7
const CRV_P256 = 1

type CborValue = number | Uint8Array | string | Map<CborValue, CborValue>

/**
 * Decodes the small CBOR subset a COSE public key uses: unsigned and negative integers, byte
 * and text strings, and maps. Anything else (indefinite lengths, arrays, tags, floats) throws.
 */
function decodeCbor(bytes: Uint8Array): CborValue {
	let pos = 0
	const byte = (): number => {
		if (pos >= bytes.length) throw new WebAuthnError('Truncated CBOR')
		return bytes[pos++]
	}
	const length = (info: number): number => {
		if (info < 24) return info
		if (info === 24) return byte()
		if (info === 25) return (byte() << 8) | byte()
		if (info === 26) return ((byte() << 24) >>> 0) + (byte() << 16) + (byte() << 8) + byte()
		throw new WebAuthnError('Unsupported CBOR length')
	}
	const take = (n: number): Uint8Array => {
		if (pos + n > bytes.length) throw new WebAuthnError('Truncated CBOR')
		const out = bytes.slice(pos, pos + n)
		pos += n
		return out
	}
	const item = (depth: number): CborValue => {
		if (depth > 4) throw new WebAuthnError('CBOR nested too deep')
		const head = byte()
		const major = head >> 5
		const n = length(head & 31)
		switch (major) {
			case 0:
				return n
			case 1:
				return -1 - n
			case 2:
				return take(n)
			case 3:
				return new TextDecoder('utf-8', { fatal: true }).decode(take(n))
			case 5: {
				const map = new Map<CborValue, CborValue>()
				for (let i = 0; i < n; i++) {
					const key = item(depth + 1)
					if (typeof key !== 'number' && typeof key !== 'string') throw new WebAuthnError('Unsupported CBOR map key')
					if (map.has(key)) throw new WebAuthnError('Duplicate CBOR map key')
					map.set(key, item(depth + 1))
				}
				return map
			}
			default:
				throw new WebAuthnError('Unsupported CBOR type')
		}
	}
	const value = item(0)
	if (pos !== bytes.length) throw new WebAuthnError('Trailing bytes after CBOR value')
	return value
}

/**
 * Parse a COSE-encoded ES256 public key into a Node key object. Refuses anything but an EC2
 * P-256 key with algorithm ES256, and any bytes beyond the one map, so a credential id and a
 * public key concatenated for the fingerprint have only one reading.
 */
export function parseCoseEs256(cose: Uint8Array): KeyObject {
	const map = decodeCbor(cose)
	if (!(map instanceof Map)) throw new WebAuthnError('COSE key is not a map')
	if (map.get(COSE_KTY) !== KTY_EC2) throw new WebAuthnError('COSE key is not an EC2 key')
	if (map.get(COSE_ALG) !== ALG_ES256) throw new WebAuthnError('COSE key is not ES256')
	if (map.get(COSE_CRV) !== CRV_P256) throw new WebAuthnError('COSE key is not on P-256')
	const x = map.get(COSE_X)
	const y = map.get(COSE_Y)
	if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
		throw new WebAuthnError('COSE key has malformed coordinates')
	}
	try {
		// Import validates that the point is on the curve.
		return createPublicKey({
			key: { kty: 'EC', crv: 'P-256', x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url') },
			format: 'jwk',
		})
	} catch {
		throw new WebAuthnError('COSE key is not a valid P-256 point')
	}
}

// ── Assertion ────────────────────────────────────────────

const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04

export interface AssertionInput {
	/** The approver's enrolled COSE public key. */
	publicKey: Uint8Array
	/** Enrolled relying-party id; the authenticator data must carry its SHA-256. */
	rpId: string
	/** Enrolled origin; `clientDataJSON.origin` must equal it exactly. */
	origin: string
	/** The challenge the verifier computed itself. */
	expectedChallenge: Uint8Array
	authenticatorData: Uint8Array
	clientDataJSON: Uint8Array
	/** DER-encoded ECDSA signature, as WebAuthn returns it. */
	signature: Uint8Array
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verify a WebAuthn `get()` assertion (WebAuthn Level 2, §7.2), requiring user verification.
 * Throws `WebAuthnError` naming the first check that failed.
 */
export function verifyAssertion(input: AssertionInput): void {
	let clientData: unknown
	try {
		clientData = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.clientDataJSON))
	} catch {
		throw new WebAuthnError('clientDataJSON is not valid JSON')
	}
	if (typeof clientData !== 'object' || clientData === null) throw new WebAuthnError('clientDataJSON is not an object')
	const { type, challenge, origin, crossOrigin } = clientData as Record<string, unknown>

	if (type !== 'webauthn.get') throw new WebAuthnError('clientDataJSON.type is not webauthn.get')
	if (typeof challenge !== 'string') throw new WebAuthnError('clientDataJSON.challenge is missing')
	let challengeBytes: Uint8Array
	try {
		challengeBytes = base64UrlToBytes(challenge)
	} catch {
		throw new WebAuthnError('clientDataJSON.challenge is not base64url')
	}
	if (!sameBytes(challengeBytes, input.expectedChallenge)) {
		throw new WebAuthnError('The signed challenge does not match this proposal and decision')
	}
	if (origin !== input.origin) throw new WebAuthnError('clientDataJSON.origin is not the enrolled origin')
	if (crossOrigin === true) throw new WebAuthnError('Cross-origin assertions are not accepted')

	const authData = input.authenticatorData
	if (authData.length < 37) throw new WebAuthnError('authenticatorData is too short')
	const rpIdHash = createHash('sha256').update(input.rpId).digest()
	if (!sameBytes(authData.subarray(0, 32), rpIdHash)) throw new WebAuthnError('authenticatorData is for another relying party')
	const flags = authData[32]
	if (!(flags & FLAG_USER_PRESENT)) throw new WebAuthnError('The authenticator did not report user presence')
	if (!(flags & FLAG_USER_VERIFIED)) throw new WebAuthnError('The authenticator did not verify the user')

	const key = parseCoseEs256(input.publicKey)
	const clientDataHash = createHash('sha256').update(input.clientDataJSON).digest()
	const signed = Buffer.concat([authData, clientDataHash])
	let valid = false
	try {
		valid = verify('sha256', signed, { key, dsaEncoding: 'der' }, input.signature)
	} catch {
		valid = false
	}
	if (!valid) throw new WebAuthnError('The signature does not verify with the enrolled key')
}
