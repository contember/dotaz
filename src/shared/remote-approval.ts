// Remote approvals: the byte-level contract shared by Dotaz and any page that approves a
// proposal with a passkey (see docs/agent-cli.md, "Remote approvals").
//
// Browser-safe on purpose: an approving page should compute the signed bytes from the very
// fields it renders, with this same definition, instead of trusting a ready-made challenge.

import { splitStatements } from './sql/statements'

/** Domain separator, so an assertion made for anything else can never verify here. */
export const APPROVAL_DOMAIN = 'dotaz-approval/v1\n'

/** SQL longer than this (UTF-8 bytes) is never approved remotely: nobody reviews it on a phone. */
export const MAX_REMOTE_SQL_BYTES = 64 * 1024

/** Upper bound on the free-text "requested by" label. */
export const MAX_REQUESTED_BY_LENGTH = 120

export type ApprovalDecision = 'approve' | 'reject'

/** Exactly the proposal fields an approver signs over, besides the nonce and the decision. */
export interface SignedProposalFields {
	id: string
	connectionId: string
	connectionName: string
	database?: string | null
	sql: string
	reason?: string | null
	requestedBy?: string | null
	createdAt: number
}

// ── Encoding helpers ─────────────────────────────────────

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Strict: only the URL-safe alphabet, no padding, no whitespace. Throws on anything else. */
export function base64UrlToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
		throw new Error('Invalid base64url')
	}
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = ''
	for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
	return hex
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, no padding. */
export function bytesToBase32(bytes: Uint8Array): string {
	let out = ''
	let buffer = 0
	let bits = 0
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte
		bits += 8
		while (bits >= 5) {
			out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31]
			bits -= 5
		}
		buffer &= (1 << bits) - 1
	}
	if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
	return out
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	// Copy into a fresh ArrayBuffer: subtle.digest rejects views over a SharedArrayBuffer.
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
}

// ── The signed bytes ─────────────────────────────────────

/** Lowercase hex SHA-256 over the UTF-8 bytes of the SQL exactly as stored. Nothing is trimmed. */
export async function sqlSha256(sql: string): Promise<string> {
	return bytesToHex(await sha256(new TextEncoder().encode(sql)))
}

/**
 * The WebAuthn challenge for one decision on one proposal:
 *
 *   SHA-256("dotaz-approval/v1\n" + JSON.stringify([nonce, decision, id, connectionId,
 *     connectionName, database, sqlSha256, reason, requestedBy, createdAt]))
 *
 * Missing optional fields are `null`. Dotaz recomputes this from its own stored proposal,
 * so a page that showed different SQL, or a different connection, produces a signature
 * that does not verify.
 */
export async function approvalChallengeBytes(nonce: string, decision: ApprovalDecision, proposal: SignedProposalFields): Promise<Uint8Array> {
	const payload = JSON.stringify([
		nonce,
		decision,
		proposal.id,
		proposal.connectionId,
		proposal.connectionName,
		proposal.database ?? null,
		await sqlSha256(proposal.sql),
		proposal.reason ?? null,
		proposal.requestedBy ?? null,
		proposal.createdAt,
	])
	return sha256(new TextEncoder().encode(APPROVAL_DOMAIN + payload))
}

/**
 * Fingerprint of an approver key, for the user to compare between the device that asks to be
 * paired and Dotaz's window: the first 16 base32 characters (80 bits, RFC 4648, uppercase) of
 * SHA-256(credential id bytes || COSE public key bytes). Dotaz only pairs a public key that
 * parses as exactly one COSE key, so the concatenation has a single reading.
 */
export async function approverFingerprint(credentialId: string, publicKey: string): Promise<string> {
	const id = base64UrlToBytes(credentialId)
	const key = base64UrlToBytes(publicKey)
	const joined = new Uint8Array(id.length + key.length)
	joined.set(id, 0)
	joined.set(key, id.length)
	return bytesToBase32(await sha256(joined)).slice(0, 16)
}

/** `ABCD EFGH IJKL MNOP`: easier to compare by eye. */
export function formatFingerprint(fingerprint: string): string {
	return fingerprint.replace(/(.{4})(?=.)/g, '$1 ')
}

// ── What a phone must never be asked to approve ──────────

/**
 * Characters that make text look different from what it is: bidi controls and other invisible
 * format characters (`\p{Cf}`), the Unicode line and paragraph separators (`\p{Zl}`, `\p{Zp}`), and C0/C1 controls
 * other than tab, line feed and carriage return.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const DECEPTIVE_CHARS = /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u

/**
 * A carriage return not followed by a line feed. Engines end a `--` comment at a bare CR, while a
 * page may render it as nothing, so text after it would look like part of the comment.
 */
const LONE_CR = /\r(?!\n)/

export function hasDeceptiveCharacters(text: string): boolean {
	return DECEPTIVE_CHARS.test(text) || LONE_CR.test(text)
}

/**
 * Comment syntax of any supported engine, anywhere in the text, string literals included. What
 * reads as a comment is not always one: MySQL runs `/*! … *\/` and `/*+ … *\/`, and treats `--`
 * as a comment only when whitespace follows. Matching inside literals too keeps this independent
 * of each engine's quoting and escaping rules; a false match only means "approve in the window".
 */
const COMMENT_MARKERS = /--|\/\*|\*\/|#/

/**
 * The only statements a remote approval may run: data manipulation. An allowlist, so a statement
 * nobody thought of (DDL that commits implicitly on MySQL, `USE`, `PRAGMA`, `ATTACH`, `SET`,
 * `CALL`, transaction control, …) is refused rather than missed.
 */
const DML_START = /^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|WITH)\b/i

/** Every piece between semicolons, trimmed, empty ones dropped. */
function semicolonPieces(sql: string): string[] {
	return sql.split(';').map((piece) => piece.trim()).filter((piece) => piece !== '')
}

/**
 * Whether a `;` sits inside a string literal, quoted identifier or dollar-quoted body. Engines
 * disagree on where those end (MySQL and Postgres `E''` strings treat `\'` as an escaped quote,
 * standard SQL does not), so the statement boundaries Dotaz sees could differ from the server's.
 * Refusing these makes the pieces between semicolons exactly the statements, for every engine.
 */
function hasSemicolonInLiteral(sql: string): boolean {
	return splitStatements(sql).length !== semicolonPieces(sql).length
}

function hasNonDmlStatement(sql: string): boolean {
	return semicolonPieces(sql).some((piece) => !DML_START.test(piece.replace(/^[(\s]+/, '')))
}

/**
 * Why a proposal cannot be approved remotely, or null when it can. Rejecting is always allowed.
 * Such a proposal can still be run from Dotaz's own window.
 */
export function remoteApprovalRefusal(proposal: Pick<SignedProposalFields, 'sql' | 'reason' | 'database'>): string | null {
	if (new TextEncoder().encode(proposal.sql).length > MAX_REMOTE_SQL_BYTES) {
		return `The SQL is longer than ${MAX_REMOTE_SQL_BYTES / 1024} KB. Approve it in the Dotaz window.`
	}
	if (hasDeceptiveCharacters(proposal.sql)) {
		return 'The SQL contains invisible, bidirectional, control or bare carriage-return characters. Approve it in the Dotaz window.'
	}
	if (COMMENT_MARKERS.test(proposal.sql)) {
		return 'The SQL contains comment syntax (--, /* */ or #), which some engines execute. Approve it in the Dotaz window.'
	}
	if (hasSemicolonInLiteral(proposal.sql)) {
		return 'The SQL has a semicolon inside a quoted string or identifier. Approve it in the Dotaz window.'
	}
	if (hasNonDmlStatement(proposal.sql)) {
		return 'Only INSERT, UPDATE, DELETE, REPLACE, MERGE and WITH statements can be approved remotely. Approve it in the Dotaz window.'
	}
	if (proposal.reason && hasDeceptiveCharacters(proposal.reason)) {
		return 'The reason contains invisible, bidirectional, control or bare carriage-return characters. Approve it in the Dotaz window.'
	}
	if (proposal.database && hasDeceptiveCharacters(proposal.database)) {
		return 'The database name contains invisible, bidirectional, control or bare carriage-return characters. Approve it in the Dotaz window.'
	}
	return null
}

/**
 * A short single-line label: 1 to `max` characters, none of them a control, format, line or
 * paragraph separator character. Used for "requested by" and for approver key labels.
 */
export function isSafeLabel(value: string, max: number): boolean {
	if (value.length === 0 || value.length > max) return false
	return !/[\p{C}\p{Zl}\p{Zp}]/u.test(value)
}
