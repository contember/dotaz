import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { isSqlDefault } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import type { DateFormat, FormatProfile } from '../../../shared/types/settings'
import { isBinaryType, isBooleanType, isJsonType, isNumericType, isTimestampType } from '../../lib/column-types'
import { settingsStore } from '../../stores/settings'
import InlineEditor from '../edit/InlineEditor'
import './GridCell.css'

interface GridCellProps {
	value: unknown
	column: GridColumnDef
	width: number
	pinStyle?: Record<string, string>
	editing?: boolean
	changed?: boolean
	selected?: boolean
	focused?: boolean
	deleted?: boolean
	newRow?: boolean
	/** FK target info for this column (if it's a single-column FK). */
	fkTarget?: { schema: string; table: string; column: string }
	/** Background color for heatmap visualization. */
	heatmapColor?: string
	onSave?: (value: unknown) => void
	onCancel?: () => void
	onMoveNext?: () => void
	onMoveDown?: () => void
	onFkClick?: () => void
}

function formatTimestamp(value: unknown, fmt: DateFormat): string {
	let d: Date | null = null
	if (value instanceof Date) {
		d = value
	} else if (typeof value === 'string') {
		const parsed = new Date(value)
		if (!Number.isNaN(parsed.getTime())) {
			d = parsed
		}
	}
	if (!d) return String(value)
	return formatDateWithProfile(d, fmt)
}

function formatDateWithProfile(d: Date, fmt: DateFormat): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	const Y = d.getFullYear()
	const M = pad(d.getMonth() + 1)
	const D = pad(d.getDate())
	const h = pad(d.getHours())
	const m = pad(d.getMinutes())
	const s = pad(d.getSeconds())

	switch (fmt) {
		case 'YYYY-MM-DD HH:mm:ss':
			return `${Y}-${M}-${D} ${h}:${m}:${s}`
		case 'DD.MM.YYYY HH:mm:ss':
			return `${D}.${M}.${Y} ${h}:${m}:${s}`
		case 'MM/DD/YYYY HH:mm:ss':
			return `${M}/${D}/${Y} ${h}:${m}:${s}`
		case 'YYYY-MM-DD':
			return `${Y}-${M}-${D}`
		case 'ISO 8601':
			return d.toISOString()
	}
}

function formatNumber(value: unknown, profile: FormatProfile): string {
	const num = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(num)) return String(value)

	let str: string
	if (profile.decimalPlaces >= 0) {
		str = num.toFixed(profile.decimalPlaces)
	} else {
		str = String(num)
	}

	const [intPart, fracPart] = str.split('.')

	let formattedInt = intPart
	if (profile.thousandsSeparator) {
		formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, profile.thousandsSeparator)
	}

	if (fracPart !== undefined) {
		return formattedInt + profile.decimalSeparator + fracPart
	}
	return formattedInt
}

function formatBoolean(value: unknown, profile: FormatProfile): string {
	const truthy = !!value
	const parts = profile.booleanDisplay.split('/')
	return truthy ? parts[0] : parts[1]
}

function formatBinary(value: unknown, profile: FormatProfile): string {
	if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
		switch (profile.binaryDisplay) {
			case 'hex':
				return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
			case 'base64':
				return btoa(String.fromCharCode(...bytes))
			case 'size':
				return `(binary ${bytes.length} bytes)`
		}
	}
	// Fallback for non-buffer binary values
	const str = String(value)
	if (profile.binaryDisplay === 'size') {
		return `(binary ${str.length} bytes)`
	}
	return str
}

export default function GridCell(props: GridCellProps) {
	const [jsonExpanded, setJsonExpanded] = createSignal(false)

	const isNull = () => props.value === null || props.value === undefined
	const isDefault = () => isSqlDefault(props.value)
	const isNumber = () => isNumericType(props.column.dataType)
	const isBool = () => isBooleanType(props.column.dataType)
	const isTs = () => isTimestampType(props.column.dataType)
	const isJson = () => isJsonType(props.column.dataType)
	const isBin = () => isBinaryType(props.column.dataType)

	const displayValue = () => {
		const profile = settingsStore.formatProfile
		if (isDefault()) return 'DEFAULT'
		if (isNull()) return profile.nullDisplay
		if (isBool()) return formatBoolean(props.value, profile)
		if (isTs()) return formatTimestamp(props.value, profile.dateFormat)
		if (isBin()) return formatBinary(props.value, profile)
		if (isNumber()) return formatNumber(props.value, profile)
		if (isJson() && typeof props.value === 'object') {
			return JSON.stringify(props.value)
		}
		return String(props.value)
	}

	const isFk = () => !!props.fkTarget && !isNull()

	const tooltipValue = (): string | undefined => {
		if (props.fkTarget && !isNull()) {
			return `\u2192 ${props.fkTarget.table}.${props.fkTarget.column}`
		}
		if (isNull()) return undefined
		if (isJson() && typeof props.value === 'object') {
			return JSON.stringify(props.value, null, 2)
		}
		const str = String(props.value)
		return str.length > 50 ? str : undefined
	}

	function handleJsonClick(e: MouseEvent) {
		if (!isJson() || isNull()) return
		e.stopPropagation()
		setJsonExpanded(!jsonExpanded())
	}

	createEffect(() => {
		if (jsonExpanded()) {
			const handler = (e: MouseEvent) => {
				const target = e.target as HTMLElement
				if (!target.closest('.grid-cell__json-popup')) {
					setJsonExpanded(false)
				}
			}
			document.addEventListener('click', handler)
			onCleanup(() => document.removeEventListener('click', handler))
		}
	})

	function handleFkClick(e: MouseEvent) {
		e.stopPropagation()
		props.onFkClick?.()
	}

	return (
		<Show
			when={!props.editing}
			fallback={
				<InlineEditor
					value={props.value}
					column={props.column}
					width={props.width}
					onSave={props.onSave!}
					onCancel={props.onCancel!}
					onMoveNext={props.onMoveNext!}
					onMoveDown={props.onMoveDown!}
				/>
			}
		>
			<div
				class="grid-cell"
				classList={{
					'grid-cell--null': isNull(),
					'grid-cell--default': isDefault(),
					'grid-cell--number': isNumber() && !isNull() && !isDefault(),
					'grid-cell--boolean': isBool() && !isNull() && !isDefault(),
					'grid-cell--json': isJson() && !isNull() && !isDefault(),
					'grid-cell--timestamp': isTs() && !isNull() && !isDefault(),
					'grid-cell--fk': isFk(),
					'grid-cell--changed': !!props.changed,
					'grid-cell--selected': !!props.selected,
					'grid-cell--focused': !!props.focused,
					'grid-cell--deleted': !!props.deleted,
					'grid-cell--new-row': !!props.newRow,
				}}
				style={{
					width: `${props.width}px`,
					...props.pinStyle,
					...(props.heatmapColor ? { 'background-color': props.heatmapColor } : {}),
				}}
				title={tooltipValue()}
				data-column={props.column.name}
				onClick={isJson() && !isNull() ? handleJsonClick : undefined}
			>
				<Show when={isFk()} fallback={displayValue()}>
					<span class="grid-cell__fk-link" onClick={handleFkClick}>
						{displayValue()}
					</span>
				</Show>

				<Show when={jsonExpanded()}>
					<div class="grid-cell__json-popup" onClick={(e) => e.stopPropagation()}>
						<pre>{JSON.stringify(props.value, null, 2)}</pre>
					</div>
				</Show>
			</div>
		</Show>
	)
}
