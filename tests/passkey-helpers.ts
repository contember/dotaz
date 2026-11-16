// A software passkey for tests: an ES256 key pair that produces WebAuthn assertions the way a
// browser and an authenticator would, with every field overridable to forge bad ones.

import { bytesToBase64Url } from '@dotaz/shared/remote-approval'
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

/** CBOR head for a major type and a small length/value. */
function head(major: number, value: number): number[] {
	if (value < 24) return [(major << 5) | value]
	if (value < 256) return [(major << 5) | 24, value]
	return [(major << 5) | 25, value >> 8, value & 0xff]
}

function cborInt(n: number): number[] {
	return n >= 0 ? head(0, n) : head(1, -1 - n)
}

function cborBytes(bytes: Uint8Array): number[] {
	return [...head(2, bytes.length), ...bytes]
}

/** COSE_Key map for an EC2 key; overrides let a test build a wrong one. */
export function coseKey(x: Uint8Array, y: Uint8Array, opts?: { kty?: number; alg?: number; crv?: number }): Uint8Array {
	return new Uint8Array([
		...head(5, 5),
		...cborInt(1),
		...cborInt(opts?.kty ?? 2),
		...cborInt(3),
		...cborInt(opts?.alg ?? -7),
		...cborInt(-1),
		...cborInt(opts?.crv ?? 1),
		...cborInt(-2),
		...cborBytes(x),
		...cborInt(-3),
		...cborBytes(y),
	])
}

export interface AssertionOverrides {
	type?: string
	origin?: string
	rpId?: string
	/** authenticator flags byte; default UP | UV */
	flags?: number
	crossOrigin?: boolean
	/** sign with another key than the paired one */
	signWith?: KeyObject
	/** challenge to put into clientDataJSON instead of the one given */
	challenge?: Uint8Array
}

export class TestPasskey {
	readonly privateKey: KeyObject
	readonly credentialId: string
	readonly publicKey: string

	constructor(readonly rpId = 'approve.example.com', readonly origin = 'https://approve.example.com') {
		const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
		this.privateKey = pair.privateKey
		const jwk = pair.publicKey.export({ format: 'jwk' })
		const x = new Uint8Array(Buffer.from(jwk.x!, 'base64url'))
		const y = new Uint8Array(Buffer.from(jwk.y!, 'base64url'))
		this.publicKey = bytesToBase64Url(coseKey(x, y))
		this.credentialId = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
	}

	pairingParams(label = 'Phone') {
		return { label, rpId: this.rpId, origin: this.origin, credentialId: this.credentialId, publicKey: this.publicKey }
	}

	/** An assertion over `challenge`, base64url-encoded the way a page would send it. */
	assert(challenge: Uint8Array, overrides: AssertionOverrides = {}) {
		const clientData: Record<string, unknown> = {
			type: overrides.type ?? 'webauthn.get',
			challenge: bytesToBase64Url(overrides.challenge ?? challenge),
			origin: overrides.origin ?? this.origin,
		}
		if (overrides.crossOrigin !== undefined) clientData.crossOrigin = overrides.crossOrigin
		const clientDataJSON = Buffer.from(JSON.stringify(clientData))
		const rpIdHash = createHash('sha256').update(overrides.rpId ?? this.rpId).digest()
		const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([overrides.flags ?? 0x05]), Buffer.from([0, 0, 0, 0])])
		const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()])
		const signature = sign('sha256', signed, overrides.signWith ?? this.privateKey)
		return {
			credentialId: this.credentialId,
			authenticatorData: authenticatorData.toString('base64url'),
			clientDataJSON: clientDataJSON.toString('base64url'),
			signature: signature.toString('base64url'),
		}
	}
}
