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
