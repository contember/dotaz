// Bridges a command's result to the selected output format.

import { capJsonRows, type OutputFormat, renderSections, type Section, truncationLine } from './format'

export interface CommandOutput {
	/** Human-readable rendering (also feeds csv/jsonl/md). */
	sections: Section[]
	/** Emitted verbatim by `--json` / `--format json`. */
	json: unknown
	/** Human-only notes — always stderr, suppressed by `--quiet`. */
	notes?: string[]
}

export interface OutputOptions {
	format: OutputFormat
	maxBytes: number
	quiet: boolean
}

export interface Rendered {
	stdout: string
	stderr: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderJson(json: unknown, maxBytes: number): Rendered {
	const full = JSON.stringify(json, null, 2) ?? 'null'
	if (Buffer.byteLength(full, 'utf8') <= maxBytes) return { stdout: `${full}\n`, stderr: '' }

	// Only row arrays are safe to shorten — dropping anything else would misrepresent the result
	if (isRecord(json) && Array.isArray(json.rows)) {
		const total = json.rows.length
		const overhead = Buffer.byteLength(JSON.stringify({ ...json, rows: [] }, null, 2) ?? '', 'utf8')
		const { kept, truncated } = capJsonRows(json.rows, maxBytes, overhead)
		const capped = { ...json, rows: kept, truncated, shown: kept.length, total }
		return { stdout: `${JSON.stringify(capped, null, 2)}\n`, stderr: truncated ? `${truncationLine(kept.length, total)}\n` : '' }
	}

	return { stdout: `${full}\n`, stderr: `output exceeds --max-bytes (${maxBytes}) and cannot be truncated safely\n` }
}

export function renderOutput(output: CommandOutput, opts: OutputOptions): Rendered {
	const notes = opts.quiet ? [] : (output.notes ?? [])
	const noteText = notes.length > 0 ? `${notes.join('\n')}\n` : ''

	if (opts.format === 'json') {
		const rendered = renderJson(output.json, opts.maxBytes)
		return { stdout: rendered.stdout, stderr: noteText + (opts.quiet ? '' : rendered.stderr) }
	}

	const rendered = renderSections(output.sections, opts.format, opts.maxBytes)
	return { stdout: rendered.stdout, stderr: noteText + (opts.quiet ? '' : rendered.stderr) }
}
