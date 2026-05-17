/**
 * Detect common image formats from binary payloads and produce data URLs for
 * inline preview in the grid / value editor.
 *
 * Binary values arrive from drivers in a few shapes depending on transport
 * (desktop/Electrobun preserves Uint8Array; WebSocket-JSON loses it). We
 * normalize all of them to Uint8Array before sniffing magic bytes.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp' | 'image/svg+xml'

const SVG_PREFIX_RE = /^\s*<(\?xml[^>]*\?>\s*)?<?svg[\s>]/i

export function toUint8Array(value: unknown): Uint8Array | null {
	if (value == null) return null
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	// Bun/Node Buffer crosses JSON as { type: 'Buffer', data: number[] }
	if (
		typeof value === 'object'
		&& value !== null
		&& (value as { type?: string }).type === 'Buffer'
		&& Array.isArray((value as { data?: unknown }).data)
	) {
		return new Uint8Array((value as { data: number[] }).data)
	}
	// Plain array of numbers (rare, but cheap to handle)
	if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
		return new Uint8Array(value as number[])
	}
	// Postgres bytea hex escape: \x00ff...
	if (typeof value === 'string' && value.startsWith('\\x')) {
		const hex = value.slice(2)
		if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
		const out = new Uint8Array(hex.length / 2)
		for (let i = 0; i < out.length; i++) {
			out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
		}
		return out
	}
	return null
}

export function detectImageMime(bytes: Uint8Array): ImageMime | null {
	if (bytes.length < 4) return null
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
	) return 'image/png'
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
	// GIF: 'GIF8'
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
	// WebP: 'RIFF' .... 'WEBP'
	if (
		bytes.length >= 12
		&& bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
		&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
	) return 'image/webp'
	// BMP: 'BM'
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
	// SVG (text): peek first ~256 bytes as utf-8 and match
	if (bytes[0] === 0x3c || bytes[0] === 0x20 || bytes[0] === 0x09 || bytes[0] === 0x0a) {
		const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 256)))
		if (SVG_PREFIX_RE.test(head)) return 'image/svg+xml'
	}
	return null
}

/**
 * Detect image from any value shape (raw bytes or text). Returns mime + the
 * original bytes (so callers can build a data URL without re-normalizing).
 */
export function detectImage(value: unknown): { mime: ImageMime; bytes: Uint8Array } | null {
	// Inline SVG often arrives as plain text from a text column
	if (typeof value === 'string' && SVG_PREFIX_RE.test(value)) {
		return { mime: 'image/svg+xml', bytes: new TextEncoder().encode(value) }
	}
	const bytes = toUint8Array(value)
	if (!bytes) return null
	const mime = detectImageMime(bytes)
	if (!mime) return null
	return { mime, bytes }
}

/** Build a data URL. Uses base64 for binary formats; UTF-8 inline for SVG. */
export function imageToDataUrl(detected: { mime: ImageMime; bytes: Uint8Array }): string {
	if (detected.mime === 'image/svg+xml') {
		const text = new TextDecoder('utf-8').decode(detected.bytes)
		return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`
	}
	// Chunked base64 to avoid call-stack blow-ups on large blobs
	const CHUNK = 0x8000
	let binary = ''
	for (let i = 0; i < detected.bytes.length; i += CHUNK) {
		const sub = detected.bytes.subarray(i, i + CHUNK)
		binary += String.fromCharCode.apply(null, sub as unknown as number[])
	}
	return `data:${detected.mime};base64,${btoa(binary)}`
}

/**
 * Format a human-readable byte count.
 */
export function formatByteSize(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
