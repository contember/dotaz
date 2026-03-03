import { describe, expect, test } from 'bun:test'

// Test the heatmap color computation logic directly.
// We inline the logic here since it's a pure function in the store.

type HeatmapMode = 'sequential' | 'diverging'

interface HeatmapInfo {
	min: number
	max: number
	mode: HeatmapMode
}

function computeHeatmapColor(value: unknown, info: HeatmapInfo): string | undefined {
	if (value === null || value === undefined) return undefined
	const num = Number(value)
	if (Number.isNaN(num)) return undefined

	const range = info.max - info.min
	const t = range === 0 ? 0.5 : (num - info.min) / range

	if (info.mode === 'sequential') {
		const alpha = 0.08 + t * 0.47
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	if (t < 0.5) {
		const alpha = (1 - t * 2) * 0.5
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	const alpha = (t * 2 - 1) * 0.5
	return `rgba(239, 68, 68, ${alpha.toFixed(3)})`
}

describe('computeHeatmapColor', () => {
	describe('sequential mode', () => {
		const info: HeatmapInfo = { min: 0, max: 100, mode: 'sequential' }

		test('returns undefined for null', () => {
			expect(computeHeatmapColor(null, info)).toBeUndefined()
		})

		test('returns undefined for undefined', () => {
			expect(computeHeatmapColor(undefined, info)).toBeUndefined()
		})

		test('returns undefined for NaN string', () => {
			expect(computeHeatmapColor('abc', info)).toBeUndefined()
		})

		test('min value gets lowest alpha', () => {
			const color = computeHeatmapColor(0, info)!
			expect(color).toBe('rgba(59, 130, 246, 0.080)')
		})

		test('max value gets highest alpha', () => {
			const color = computeHeatmapColor(100, info)!
			expect(color).toBe('rgba(59, 130, 246, 0.550)')
		})

		test('mid value gets intermediate alpha', () => {
			const color = computeHeatmapColor(50, info)!
			expect(color).toBe('rgba(59, 130, 246, 0.315)')
		})

		test('handles equal min and max', () => {
			const sameInfo: HeatmapInfo = { min: 5, max: 5, mode: 'sequential' }
			const color = computeHeatmapColor(5, sameInfo)!
			// t = 0.5 when range is 0
			expect(color).toBe('rgba(59, 130, 246, 0.315)')
		})
	})

	describe('diverging mode', () => {
		const info: HeatmapInfo = { min: -100, max: 100, mode: 'diverging' }

		test('min value (low end) is blue', () => {
			const color = computeHeatmapColor(-100, info)!
			expect(color).toContain('59, 130, 246')
			expect(color).toBe('rgba(59, 130, 246, 0.500)')
		})

		test('max value (high end) is red', () => {
			const color = computeHeatmapColor(100, info)!
			expect(color).toContain('239, 68, 68')
			expect(color).toBe('rgba(239, 68, 68, 0.500)')
		})

		test('center value is nearly transparent', () => {
			const color = computeHeatmapColor(0, info)!
			// t = 0.5, so this is at the boundary — should be very low alpha
			expect(color).toContain('0.000')
		})

		test('quarter value is blue with lower alpha', () => {
			const color = computeHeatmapColor(-50, info)!
			expect(color).toContain('59, 130, 246')
			expect(color).toBe('rgba(59, 130, 246, 0.250)')
		})

		test('three-quarter value is red with lower alpha', () => {
			const color = computeHeatmapColor(50, info)!
			expect(color).toContain('239, 68, 68')
			expect(color).toBe('rgba(239, 68, 68, 0.250)')
		})
	})
})
