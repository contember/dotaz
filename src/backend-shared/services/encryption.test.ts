import { describe, test, expect } from "bun:test";
import { EncryptionService, createLocalKey, encryptLocalPassword, decryptLocalPassword, isEncryptedPassword } from "./encryption";
import { hkdfSync } from "node:crypto";

describe("EncryptionService", () => {
	test("encrypt and decrypt round-trip", async () => {
		const service = new EncryptionService("test-passphrase");
		const plaintext = '{"host":"localhost","port":5432,"password":"secret"}';

		const encrypted = await service.encrypt(plaintext);
		expect(encrypted).not.toBe(plaintext);

		const decrypted = await service.decrypt(encrypted);
		expect(decrypted).toBe(plaintext);
	});

	test("different encryptions produce different ciphertext", async () => {
		const service = new EncryptionService("test-passphrase");
		const plaintext = "same input";

		const a = await service.encrypt(plaintext);
		const b = await service.encrypt(plaintext);

		expect(a).not.toBe(b); // fresh IV each time
	});

	test("different keys cannot decrypt each other's data", async () => {
		const service1 = new EncryptionService("key-one");
		const service2 = new EncryptionService("key-two");

		const encrypted = await service1.encrypt("secret data");

		expect(service2.decrypt(encrypted)).rejects.toThrow();
	});

	test("handles empty string", async () => {
		const service = new EncryptionService("test-key");
		const encrypted = await service.encrypt("");
		const decrypted = await service.decrypt(encrypted);
		expect(decrypted).toBe("");
	});

	test("handles unicode content", async () => {
		const service = new EncryptionService("test-key");
		const plaintext = '{"name":"テスト","emoji":"🔐"}';
		const encrypted = await service.encrypt(plaintext);
		const decrypted = await service.decrypt(encrypted);
		expect(decrypted).toBe(plaintext);
	});

	test("tampered ciphertext fails to decrypt", async () => {
		const service = new EncryptionService("test-key");
		const encrypted = await service.encrypt("data");

		// Flip a byte in the middle of the ciphertext
		const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
		bytes[bytes.length - 5] ^= 0xff;
		const tampered = btoa(String.fromCharCode(...bytes));

		expect(service.decrypt(tampered)).rejects.toThrow();
	});
});

// ── Local password encryption ────────────────────────────────

describe("Local password encryption", () => {
	// Derive a deterministic test key (not machine-dependent)
	const testKey = new Uint8Array(
		hkdfSync("sha256", "test-machine-data", "dotaz-local-salt", "dotaz-local-key", 32),
	);

	test("createLocalKey returns a Uint8Array", () => {
		const key = createLocalKey();
		expect(key).not.toBeNull();
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key!.length).toBe(32);
	});

	test("createLocalKey returns consistent key across calls", () => {
		const key1 = createLocalKey();
		const key2 = createLocalKey();
		expect(key1).toEqual(key2);
	});

	test("encrypt and decrypt round-trip", () => {
		const password = "my-secret-password";
		const encrypted = encryptLocalPassword(password, testKey);
		expect(encrypted).not.toBe(password);
		expect(encrypted.startsWith("enc:v1:")).toBe(true);

		const decrypted = decryptLocalPassword(encrypted, testKey);
		expect(decrypted).toBe(password);
	});

	test("different encryptions produce different ciphertext", () => {
		const password = "same-password";
		const a = encryptLocalPassword(password, testKey);
		const b = encryptLocalPassword(password, testKey);
		expect(a).not.toBe(b); // fresh IV each time
	});

	test("plaintext passthrough in decryptLocalPassword", () => {
		const plaintext = "not-encrypted";
		const result = decryptLocalPassword(plaintext, testKey);
		expect(result).toBe(plaintext);
	});

	test("isEncryptedPassword detects prefix", () => {
		expect(isEncryptedPassword("enc:v1:abc")).toBe(true);
		expect(isEncryptedPassword("plaintext")).toBe(false);
		expect(isEncryptedPassword("")).toBe(false);
	});

	test("handles empty password", () => {
		const encrypted = encryptLocalPassword("", testKey);
		const decrypted = decryptLocalPassword(encrypted, testKey);
		expect(decrypted).toBe("");
	});

	test("handles unicode password", () => {
		const password = "пароль-🔐-密码";
		const encrypted = encryptLocalPassword(password, testKey);
		const decrypted = decryptLocalPassword(encrypted, testKey);
		expect(decrypted).toBe(password);
	});

	test("different keys cannot decrypt each other's data", () => {
		const key2 = new Uint8Array(
			hkdfSync("sha256", "different-machine", "dotaz-local-salt", "dotaz-local-key", 32),
		);
		const encrypted = encryptLocalPassword("secret", testKey);
		expect(() => decryptLocalPassword(encrypted, key2)).toThrow();
	});

	test("tampered ciphertext fails to decrypt", () => {
		const encrypted = encryptLocalPassword("data", testKey);
		// Flip a byte in the base64 payload
		const prefix = "enc:v1:";
		const payload = encrypted.slice(prefix.length);
		const bytes = new Uint8Array(Buffer.from(payload, "base64"));
		bytes[bytes.length - 3] ^= 0xff;
		const tampered = prefix + Buffer.from(bytes).toString("base64");
		expect(() => decryptLocalPassword(tampered, testKey)).toThrow();
	});
});
