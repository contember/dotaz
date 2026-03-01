import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { hostname, userInfo } from "node:os";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

export class EncryptionService {
	private keyPromise: Promise<CryptoKey>;

	constructor(passphrase: string) {
		this.keyPromise = deriveKey(passphrase);
	}

	async encrypt(plaintext: string): Promise<string> {
		const key = await this.keyPromise;
		const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
		const encoded = new TextEncoder().encode(plaintext);

		const ciphertext = await crypto.subtle.encrypt(
			{ name: ALGORITHM, iv },
			key,
			encoded,
		);

		// Combine IV + ciphertext (GCM auth tag is appended by the browser)
		const combined = new Uint8Array(iv.length + ciphertext.byteLength);
		combined.set(iv, 0);
		combined.set(new Uint8Array(ciphertext), iv.length);

		return Buffer.from(combined).toString("base64");
	}

	async decrypt(encoded: string): Promise<string> {
		const key = await this.keyPromise;
		const combined = new Uint8Array(Buffer.from(encoded, "base64"));

		const iv = combined.slice(0, IV_LENGTH);
		const ciphertext = combined.slice(IV_LENGTH);

		const decrypted = await crypto.subtle.decrypt(
			{ name: ALGORITHM, iv },
			key,
			ciphertext,
		);

		return new TextDecoder().decode(decrypted);
	}
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
	const encoded = new TextEncoder().encode(passphrase);

	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoded,
		"HKDF",
		false,
		["deriveKey"],
	);

	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new TextEncoder().encode("dotaz-encryption-salt"),
			info: new TextEncoder().encode("dotaz-aes-key"),
		},
		keyMaterial,
		{ name: ALGORITHM, length: KEY_LENGTH },
		false,
		["encrypt", "decrypt"],
	);
}

// ── Local password encryption (synchronous, machine-derived key) ────

const ENCRYPTED_PREFIX = "enc:v1:";
const LOCAL_IV_LENGTH = 12;
const LOCAL_AUTH_TAG_LENGTH = 16;

/**
 * Derive a machine-local encryption key from hostname + username.
 * Returns null if derivation fails (caller should fall back to plaintext).
 */
export function createLocalKey(): Uint8Array | null {
	try {
		const machine = `${hostname()}:${userInfo().username}`;
		return new Uint8Array(
			hkdfSync("sha256", machine, "dotaz-local-salt", "dotaz-local-key", 32),
		);
	} catch (err) {
		console.warn("Failed to derive local encryption key, passwords will be stored as plaintext:", err);
		return null;
	}
}

/**
 * Encrypt a password using the local key. Returns a prefixed base64 string.
 */
export function encryptLocalPassword(password: string, key: Uint8Array): string {
	const iv = new Uint8Array(randomBytes(LOCAL_IV_LENGTH));
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encPart = cipher.update(password, "utf8");
	const finalPart = cipher.final();
	const authTag = new Uint8Array(cipher.getAuthTag());

	const encrypted = new Uint8Array(encPart.length + finalPart.length);
	encrypted.set(encPart, 0);
	encrypted.set(finalPart, encPart.length);

	const combined = new Uint8Array(iv.length + authTag.length + encrypted.length);
	combined.set(iv, 0);
	combined.set(authTag, iv.length);
	combined.set(encrypted, iv.length + authTag.length);
	return ENCRYPTED_PREFIX + Buffer.from(combined).toString("base64");
}

/**
 * Decrypt a password encrypted with encryptLocalPassword.
 * If the value doesn't have the encrypted prefix, returns it as-is (plaintext passthrough).
 */
export function decryptLocalPassword(value: string, key: Uint8Array): string {
	if (!value.startsWith(ENCRYPTED_PREFIX)) {
		return value;
	}
	const data = new Uint8Array(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64"));
	const iv = data.subarray(0, LOCAL_IV_LENGTH);
	const authTag = data.subarray(LOCAL_IV_LENGTH, LOCAL_IV_LENGTH + LOCAL_AUTH_TAG_LENGTH);
	const encrypted = data.subarray(LOCAL_IV_LENGTH + LOCAL_AUTH_TAG_LENGTH);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(authTag);
	return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

/**
 * Check if a password string is encrypted (has the encryption prefix).
 */
export function isEncryptedPassword(value: string): boolean {
	return value.startsWith(ENCRYPTED_PREFIX);
}
