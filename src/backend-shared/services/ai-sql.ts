/**
 * AI SQL generation service — generates SQL from natural language using an LLM API.
 * Supports Anthropic Claude, OpenAI, and custom endpoints.
 */

import type { SchemaData } from '@dotaz/shared/types/database'
import type { AiConfig } from '@dotaz/shared/types/settings'

export interface AiSqlOptions {
	prompt: string
	schemaContext: string
	dialect: 'postgresql' | 'sqlite' | 'mysql'
}

const SYSTEM_PROMPT = `You are an expert SQL query generator. Given a database schema and a natural language request, generate a valid SQL query.

Rules:
- Output ONLY the SQL query — no explanations, no markdown, no code fences.
- Use the correct SQL dialect as specified.
- Use table and column names exactly as they appear in the schema.
- Use proper JOINs based on foreign key relationships when needed.
- Use appropriate casting and comparison operators for the column types.
- Generate only SELECT queries by default unless the user explicitly asks for INSERT, UPDATE, or DELETE.
- If the request is ambiguous, make reasonable assumptions and generate the most likely intended query.`

/**
 * Build a compact text representation of the database schema for the LLM context.
 * Limits output to stay within reasonable token budgets.
 */
export function buildSchemaContext(schema: SchemaData, maxTables = 50): string {
	const lines: string[] = []

	let tableCount = 0
	for (const [schemaName, tables] of Object.entries(schema.tables)) {
		for (const table of tables) {
			if (tableCount >= maxTables) break
			tableCount++

			const columns = schema.columns[`${schemaName}.${table.name}`] ?? []
			const fks = schema.foreignKeys[`${schemaName}.${table.name}`] ?? []

			const colDefs = columns.map((col) => {
				const parts = [col.name, col.dataType]
				if (col.isPrimaryKey) parts.push('PK')
				if (!col.nullable) parts.push('NOT NULL')
				if (col.isAutoIncrement) parts.push('AUTO_INCREMENT')
				return parts.join(' ')
			})

			const qualified = schemaName === 'main' || schemaName === 'public'
				? table.name
				: `${schemaName}.${table.name}`

			lines.push(`TABLE ${qualified} (${colDefs.join(', ')})`)

			for (const fk of fks) {
				const refTable = fk.referencedSchema === 'main' || fk.referencedSchema === 'public'
					? fk.referencedTable
					: `${fk.referencedSchema}.${fk.referencedTable}`
				lines.push(
					`  FK ${fk.columns.join(',')} -> ${refTable}(${fk.referencedColumns.join(',')})`,
				)
			}
		}
	}

	return lines.join('\n')
}

/**
 * Call the Anthropic Messages API to generate SQL.
 */
async function callAnthropic(config: AiConfig, opts: AiSqlOptions): Promise<string> {
	const endpoint = config.endpoint || 'https://api.anthropic.com'
	const url = `${endpoint}/v1/messages`

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': config.apiKey,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: `SQL dialect: ${opts.dialect}\n\nDatabase schema:\n${opts.schemaContext}\n\nRequest: ${opts.prompt}`,
				},
			],
		}),
	})

	if (!response.ok) {
		const body = await response.text().catch(() => '')
		if (response.status === 401) throw new Error('Invalid API key. Check your AI settings.')
		if (response.status === 429) throw new Error('Rate limited. Please wait and try again.')
		throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 200)}`)
	}

	const data = await response.json() as { content: { type: string; text: string }[] }
	const textBlock = data.content?.find((b) => b.type === 'text')
	return extractSql(textBlock?.text ?? '')
}

/**
 * Call the OpenAI Chat Completions API to generate SQL.
 */
async function callOpenAI(config: AiConfig, opts: AiSqlOptions): Promise<string> {
	const endpoint = config.endpoint || 'https://api.openai.com'
	const url = `${endpoint}/v1/chat/completions`

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model || 'gpt-4o',
			max_tokens: 2048,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: `SQL dialect: ${opts.dialect}\n\nDatabase schema:\n${opts.schemaContext}\n\nRequest: ${opts.prompt}`,
				},
			],
		}),
	})

	if (!response.ok) {
		const body = await response.text().catch(() => '')
		if (response.status === 401) throw new Error('Invalid API key. Check your AI settings.')
		if (response.status === 429) throw new Error('Rate limited. Please wait and try again.')
		throw new Error(`OpenAI API error (${response.status}): ${body.slice(0, 200)}`)
	}

	const data = await response.json() as { choices: { message: { content: string } }[] }
	return extractSql(data.choices?.[0]?.message?.content ?? '')
}

/**
 * Call a custom OpenAI-compatible endpoint.
 */
async function callCustom(config: AiConfig, opts: AiSqlOptions): Promise<string> {
	if (!config.endpoint) throw new Error('Custom AI endpoint URL is required. Check your AI settings.')
	return callOpenAI(config, opts)
}

/**
 * Extract SQL from LLM response, stripping markdown code fences if present.
 */
function extractSql(text: string): string {
	let sql = text.trim()
	// Strip markdown code fences
	const fenceMatch = sql.match(/^```(?:sql)?\s*\n?([\s\S]*?)\n?```$/)
	if (fenceMatch) {
		sql = fenceMatch[1].trim()
	}
	return sql
}

/**
 * Generate SQL from a natural language prompt using the configured LLM provider.
 */
export async function generateSql(config: AiConfig, opts: AiSqlOptions): Promise<string> {
	if (!config.apiKey) {
		throw new Error('AI API key not configured. Go to AI Settings (command palette) to set it up.')
	}

	switch (config.provider) {
		case 'anthropic':
			return callAnthropic(config, opts)
		case 'openai':
			return callOpenAI(config, opts)
		case 'custom':
			return callCustom(config, opts)
		default:
			throw new Error(`Unknown AI provider: ${config.provider}`)
	}
}
