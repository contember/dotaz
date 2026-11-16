import { parseCoseEs256, verifyAssertion, WebAuthnError } from '@dotaz/backend-shared/services/webauthn'
import {
	approvalChallengeBytes,
	approverFingerprint,
	base64UrlToBytes,
	bytesToBase32,
	bytesToBase64Url,
	hasDeceptiveCharacters,
	isSafeLabel,
	MAX_REMOTE_SQL_BYTES,
	remoteApprovalRefusal,
	sqlSha256,
} from '@dotaz/shared/remote-approval'
import { describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { coseKey, TestPasskey, type TestPasskey as TestPasskeyType } from './passkey-helpers'

const challenge = new Uint8Array(32).fill(7)
/** Written as code points: the characters themselves are invisible in source. */
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)

function verify(passkey: TestPasskeyType, assertion: ReturnType<TestPasskeyType['assert']>, expected = challenge) {
	verifyAssertion({
		publicKey: base64UrlToBytes(passkey.publicKey),
		rpId: passkey.rpId,
		origin: passkey.origin,
		expectedChallenge: expected,
		authenticatorData: base64UrlToBytes(assertion.authenticatorData),
		clientDataJSON: base64UrlToBytes(assertion.clientDataJSON),
		signature: base64UrlToBytes(assertion.signature),
	})
}

describe('WebAuthn ES256 verifier', () => {
	const passkey = new TestPasskey()

	test('accepts a genuine assertion with user verification', () => {
		expect(() => verify(passkey, passkey.assert(challenge))).not.toThrow()
	})

	test('refuses an assertion over another challenge', () => {
		const other = new Uint8Array(32).fill(8)
		expect(() => verify(passkey, passkey.assert(other))).toThrow(/challenge does not match/)
	})

	test('refuses a create() ceremony', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { type: 'webauthn.create' }))).toThrow(/type/)
	})

	test('refuses another origin, e.g. a page on another localhost port', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { origin: 'https://evil.example.com' }))).toThrow(/origin/)
	})

	test('refuses a cross-origin iframe assertion', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { crossOrigin: true }))).toThrow(/Cross-origin/)
	})

	test('refuses an assertion for another relying party', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { rpId: 'other.example.com' }))).toThrow(/relying party/)
	})

	test('refuses an assertion without user verification', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { flags: 0x01 }))).toThrow(/verify the user/)
	})

	test('refuses an assertion without user presence', () => {
		expect(() => verify(passkey, passkey.assert(challenge, { flags: 0x04 }))).toThrow(/user presence/)
	})

	test('refuses a signature by another key', () => {
		const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
		expect(() => verify(passkey, passkey.assert(challenge, { signWith: other }))).toThrow(/signature/)
	})

	test('refuses authenticator data that was altered after signing', () => {
		const assertion = passkey.assert(challenge)
		const data = base64UrlToBytes(assertion.authenticatorData)
		data[36] ^= 1 // sign counter byte
		expect(() => verify(passkey, { ...assertion, authenticatorData: bytesToBase64Url(data) })).toThrow(/signature/)
	})

	test('all failures are WebAuthnError', () => {
		try {
			verify(passkey, passkey.assert(challenge, { flags: 0 }))
			throw new Error('should have thrown')
		} catch (err) {
			expect(err).toBeInstanceOf(WebAuthnError)
		}
	})
})

describe('COSE key parsing', () => {
	const x = new Uint8Array(32).fill(1)
	const y = new Uint8Array(32).fill(2)

	test('accepts a real P-256 key', () => {
		const passkey = new TestPasskey()
		expect(() => parseCoseEs256(base64UrlToBytes(passkey.publicKey))).not.toThrow()
	})

	test('refuses another key type, algorithm or curve', () => {
		expect(() => parseCoseEs256(coseKey(x, y, { kty: 3 }))).toThrow(/EC2/)
		expect(() => parseCoseEs256(coseKey(x, y, { alg: -257 }))).toThrow(/ES256/)
		expect(() => parseCoseEs256(coseKey(x, y, { crv: 2 }))).toThrow(/P-256/)
	})

	test('refuses a point that is not on the curve', () => {
		expect(() => parseCoseEs256(coseKey(x, y))).toThrow(/valid P-256 point/)
	})

	test('refuses trailing bytes, so credential id + key has one reading', () => {
		const passkey = new TestPasskey()
		const bytes = base64UrlToBytes(passkey.publicKey)
		const extended = new Uint8Array([...bytes, 0])
		expect(() => parseCoseEs256(extended)).toThrow(/Trailing/)
	})
})

describe('signed bytes and fingerprints', () => {
	test('challenge bytes match an independently computed vector', async () => {
		// Same vector as an approving client computed on its own side.
		const bytes = await approvalChallengeBytes('bm9uY2U', 'approve', {
			id: 'p-1',
			connectionId: 'c-1',
			connectionName: 'Produkce ‹šťastná›',
			database: 'app',
			sql: "UPDATE t SET a = 'ž'\nWHERE id = 1;",
			reason: null,
			requestedBy: 'sdk-x T7',
			createdAt: 1763330000000,
		})
		expect(bytesToBase64Url(bytes)).toBe('sh_guKrMpHiBBObA8HWLCtPZSwjTKAgEqAlh-7GaIsc')
	})

	test('every signed field changes the challenge, including whitespace in the SQL', async () => {
		const base = {
			id: 'p-1',
			connectionId: 'c-1',
			connectionName: 'prod',
			database: 'app',
			sql: 'DELETE FROM t WHERE id = 1',
			reason: 'cleanup',
			requestedBy: 'agent',
			createdAt: 1,
		}
		const reference = bytesToBase64Url(await approvalChallengeBytes('n', 'approve', base))
		const variants = [
			approvalChallengeBytes('m', 'approve', base),
			approvalChallengeBytes('n', 'reject', base),
			approvalChallengeBytes('n', 'approve', { ...base, id: 'p-2' }),
			approvalChallengeBytes('n', 'approve', { ...base, connectionId: 'c-2' }),
			approvalChallengeBytes('n', 'approve', { ...base, connectionName: 'staging' }),
			approvalChallengeBytes('n', 'approve', { ...base, database: null }),
			approvalChallengeBytes('n', 'approve', { ...base, sql: 'DELETE FROM t WHERE id = 1 ' }),
			approvalChallengeBytes('n', 'approve', { ...base, reason: null }),
			approvalChallengeBytes('n', 'approve', { ...base, requestedBy: 'someone else' }),
			approvalChallengeBytes('n', 'approve', { ...base, createdAt: 2 }),
		]
		for (const variant of await Promise.all(variants)) {
			expect(bytesToBase64Url(variant)).not.toBe(reference)
		}
	})

	test('sqlSha256 hashes the exact UTF-8 bytes', async () => {
		const sql = "UPDATE t SET a = 'ž' "
		expect(await sqlSha256(sql)).toBe(createHash('sha256').update(sql, 'utf8').digest('hex'))
	})

	test('fingerprint is 16 base32 characters over credential id bytes followed by key bytes', async () => {
		const passkey = new TestPasskey()
		const joined = Buffer.concat([base64UrlToBytes(passkey.credentialId), base64UrlToBytes(passkey.publicKey)])
		const expected = bytesToBase32(new Uint8Array(createHash('sha256').update(joined).digest())).slice(0, 16)
		const fingerprint = await approverFingerprint(passkey.credentialId, passkey.publicKey)
		expect(fingerprint).toBe(expected)
		expect(fingerprint).toMatch(/^[A-Z2-7]{16}$/)
	})

	test('base32 follows RFC 4648', () => {
		expect(bytesToBase32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
	})

	test('base64url decoding is strict', () => {
		expect(() => base64UrlToBytes('ab+c')).toThrow()
		expect(() => base64UrlToBytes('abc=')).toThrow()
		expect(() => base64UrlToBytes('a')).toThrow()
	})
})

describe('what is never approved remotely', () => {
	test('bidi, invisible and control characters', () => {
		for (const code of [0x202e, 0x200b, 0x2066, 0xfeff, 0x2028, 0x2029, 0x00, 0x1b, 0x7f, 0x85]) {
			expect(hasDeceptiveCharacters(`DELETE FROM t${String.fromCharCode(code)}`)).toBe(true)
		}
		expect(hasDeceptiveCharacters("UPDATE t\n\tSET a = 'ž'\r\n")).toBe(false)
	})

	test('SQL over 64 KB, measured in UTF-8 bytes', () => {
		const ascii = `SELECT '${'a'.repeat(MAX_REMOTE_SQL_BYTES - 9)}'`
		expect(new TextEncoder().encode(ascii).length).toBe(MAX_REMOTE_SQL_BYTES)
		expect(remoteApprovalRefusal({ sql: ascii })).toBeNull()
		expect(remoteApprovalRefusal({ sql: `${ascii} ` })).toMatch(/64 KB/)
		// 2-byte characters: under the limit in UTF-16 units, over it in bytes
		expect(remoteApprovalRefusal({ sql: 'ž'.repeat(MAX_REMOTE_SQL_BYTES / 2 + 1) })).toMatch(/64 KB/)
	})

	test('deceptive characters in the reason or database name too', () => {
		expect(remoteApprovalRefusal({ sql: 'DELETE FROM t', reason: `fix ${RLO}` })).toMatch(/reason/)
		expect(remoteApprovalRefusal({ sql: 'DELETE FROM t', database: `app${ZWSP}` })).toMatch(/database/)
	})

	test('labels are single-line printable text with a length cap', () => {
		expect(isSafeLabel('agent T7', 120)).toBe(true)
		expect(isSafeLabel('', 120)).toBe(false)
		expect(isSafeLabel('a\nb', 120)).toBe(false)
		expect(isSafeLabel(`a${RLO}b`, 120)).toBe(false)
		expect(isSafeLabel('a'.repeat(121), 120)).toBe(false)
	})
})
