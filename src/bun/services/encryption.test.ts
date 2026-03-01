import { describe, test, expect } from "bun:test";
import { EncryptionService } from "./encryption";

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
