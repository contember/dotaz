import { describe, expect, test } from 'bun:test'
import { detectImage, detectImageMime, imageToDataUrl, toUint8Array } from '../src/frontend-shared/lib/binary-preview'

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const BMP_HEADER = new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00])
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
const RANDOM = new Uint8Array([0x00, 0x01, 0x02, 0x03])

describe('detectImageMime', () => {
	test('detects PNG', () => {
		expect(detectImageMime(PNG_HEADER)).toBe('image/png')
	})

	test('detects JPEG', () => {
		expect(detectImageMime(JPEG_HEADER)).toBe('image/jpeg')
	})

	test('detects GIF', () => {
		expect(detectImageMime(GIF_HEADER)).toBe('image/gif')
	})

	test('detects WebP', () => {
		expect(detectImageMime(WEBP_HEADER)).toBe('image/webp')
	})

	test('detects BMP', () => {
		expect(detectImageMime(BMP_HEADER)).toBe('image/bmp')
	})

	test('returns null for non-image bytes', () => {
		expect(detectImageMime(RANDOM)).toBeNull()
	})

	test('returns null for too-short input', () => {
		expect(detectImageMime(new Uint8Array([0x89, 0x50]))).toBeNull()
	})
})

describe('toUint8Array', () => {
	test('passes Uint8Array through', () => {
		expect(toUint8Array(PNG_HEADER)).toBe(PNG_HEADER)
	})

	test('wraps ArrayBuffer', () => {
		const buf = PNG_HEADER.buffer.slice(0)
		const out = toUint8Array(buf)!
		expect(out).toBeInstanceOf(Uint8Array)
		expect(out[0]).toBe(0x89)
	})

	test('decodes Node-style Buffer JSON shape', () => {
		const obj = { type: 'Buffer', data: [0x89, 0x50, 0x4e, 0x47] }
		const out = toUint8Array(obj)!
		expect(out[0]).toBe(0x89)
		expect(out[3]).toBe(0x47)
	})

	test('decodes Postgres bytea hex string', () => {
		const out = toUint8Array('\\x89504e47')!
		expect(out.length).toBe(4)
		expect(out[0]).toBe(0x89)
	})

	test('returns null for plain text strings', () => {
		expect(toUint8Array('hello world')).toBeNull()
	})

	test('returns null for null/undefined', () => {
		expect(toUint8Array(null)).toBeNull()
		expect(toUint8Array(undefined)).toBeNull()
	})
})

describe('detectImage', () => {
	test('detects PNG payload', () => {
		expect(detectImage(PNG_HEADER)?.mime).toBe('image/png')
	})

	test('detects SVG from plain text', () => {
		const r = detectImage(SVG_TEXT)
		expect(r?.mime).toBe('image/svg+xml')
	})

	test('detects PNG from Postgres hex bytea', () => {
		const hex = '\\x' + Array.from(PNG_HEADER, (b) => b.toString(16).padStart(2, '0')).join('')
		expect(detectImage(hex)?.mime).toBe('image/png')
	})

	test('returns null for non-image binary', () => {
		expect(detectImage(RANDOM)).toBeNull()
	})
})

describe('imageToDataUrl', () => {
	test('produces a base64 data URL for raster images', () => {
		const url = imageToDataUrl({ mime: 'image/png', bytes: PNG_HEADER })
		expect(url).toMatch(/^data:image\/png;base64,/)
	})

	test('produces a utf-8 data URL for SVG', () => {
		const bytes = new TextEncoder().encode(SVG_TEXT)
		const url = imageToDataUrl({ mime: 'image/svg+xml', bytes })
		expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true)
		expect(decodeURIComponent(url.slice('data:image/svg+xml;utf8,'.length))).toBe(SVG_TEXT)
	})
})
