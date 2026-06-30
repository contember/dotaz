import { isBinaryType, isBooleanType, isNumericType, isStructuredType, isTimestampType } from '@dotaz/shared/column-types'
import { isSqlDefault } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { detectImage, imageToDataUrl } from '../../lib/binary-preview'
import { formatBinary, formatBoolean, formatNumberWithProfile, formatTimestamp } from '../../lib/cell-formatters'
import { formatJsonValue } from '../../lib/value-format'
import { settingsStore } from '../../stores/settings'
import InlineEditor from '../edit/InlineEditor'
import './GridCell.css'

/** Skip thumbnailing huge blobs in the grid — they aren't visible at 24px anyway and decoding kills scroll. */
const MAX_GRID_THUMB_BYTES = 2 * 1024 * 1024

interface GridCellProps {
	value: unknown
	column: GridColumnDef
	width: number
	pinStyle?: Record<string, string>
	editing?: boolean
	initialEditValue?: unknown
	changed?: boolean
	selected?: boolean
	focused?: boolean
	deleted?: boolean
	newRow?: boolean
	/** FK target info for this column (if it's a single-column FK). */
	fkTarget?: { schema: string; table: string; column: string }
	/** Whether this column is a primary key (enables PK peek on click). */
	pkColumn?: boolean
	/** Background color for heatmap visualization. */
	heatmapColor?: string
	/** Live-mode highlight intensity (0..1), 0 = no highlight. */
	liveChangeIntensity?: number
	onSave?: (value: unknown) => void
	onCancel?: () => void
	onMoveNext?: () => void
	onMoveDown?: () => void
	onFkClick?: (anchorEl: HTMLElement) => void
	onPkClick?: (anchorEl: HTMLElement) => void
	onBrowseFk?: () => void
}

export default function GridCell(props: GridCellProps) {
	const [jsonExpanded, setJsonExpanded] = createSignal(false)

	const isNull = () => props.value === null || props.value === undefined
	const isDefault = () => isSqlDefault(props.value)
	const isNumber = () => isNumericType(props.column.dataType)
	const isBool = () => isBooleanType(props.column.dataType)
	const isTs = () => isTimestampType(props.column.dataType)
	const isJson = () => isStructuredType(props.column.dataType)
	const isBin = () => isBinaryType(props.column.dataType)

	const displayValue = () => {
		const profile = settingsStore.formatProfile
		if (isDefault()) return 'DEFAULT'
		if (isNull()) return profile.nullDisplay
		if (isBool()) return formatBoolean(props.value, profile)
		if (isTs()) return formatTimestamp(props.value, profile.dateFormat)
		if (isBin()) return formatBinary(props.value, profile)
		if (isNumber()) return formatNumberWithProfile(props.value, profile)
		if (isJson()) return formatJsonValue(props.value)
		return String(props.value)
	}

	const imagePreview = createMemo(() => {
		if (!isBin() || isNull() || isDefault()) return null
		const detected = detectImage(props.value)
		if (!detected) return null
		if (detected.bytes.length > MAX_GRID_THUMB_BYTES) return null
		return imageToDataUrl(detected)
	})

	const isFk = () => !!props.fkTarget && !isNull()
	const isPk = () => !!props.pkColumn && !isNull() && !isDefault() && !isFk()

	const tooltipValue = (): string | undefined => {
		if (props.fkTarget && !isNull()) {
			return `\u2192 ${props.fkTarget.table}.${props.fkTarget.column}`
		}
		if (isNull()) return undefined
		if (isJson()) return formatJsonValue(props.value, true)
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
		props.onFkClick?.(e.currentTarget as HTMLElement)
	}

	function handlePkClick(e: MouseEvent) {
		e.stopPropagation()
		props.onPkClick?.(e.currentTarget as HTMLElement)
	}

	return (
		<Show
			when={!props.editing}
			fallback={
				<InlineEditor
					value={props.value}
					initialValue={props.initialEditValue}
					column={props.column}
					width={props.width}
					onSave={props.onSave!}
					onCancel={props.onCancel!}
					onMoveNext={props.onMoveNext!}
					onMoveDown={props.onMoveDown!}
					fkTarget={props.fkTarget}
					onBrowseFk={props.onBrowseFk}
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
					'grid-cell--pk': isPk(),
					'grid-cell--changed': !!props.changed,
					'grid-cell--selected': !!props.selected,
					'grid-cell--focused': !!props.focused,
					'grid-cell--deleted': !!props.deleted,
					'grid-cell--new-row': !!props.newRow,
					'grid-cell--live-changed': (props.liveChangeIntensity ?? 0) > 0,
				}}
				style={{
					width: `${props.width}px`,
					...props.pinStyle,
					...(props.heatmapColor ? { 'background-color': props.heatmapColor } : {}),
					...((props.liveChangeIntensity ?? 0) > 0
						? { '--live-cell-intensity': (props.liveChangeIntensity ?? 0).toFixed(3) }
						: {}),
				}}
				title={tooltipValue()}
				data-column={props.column.name}
				onClick={isJson() && !isNull() ? handleJsonClick : undefined}
			>
				<Show
					when={imagePreview()}
					fallback={
						<Show
							when={isFk()}
							fallback={
								<Show when={isPk()} fallback={displayValue()}>
									<span class="grid-cell__pk-link" onClick={handlePkClick}>
										{displayValue()}
									</span>
								</Show>
							}
						>
							<span class="grid-cell__fk-link" onClick={handleFkClick}>
								{displayValue()}
							</span>
						</Show>
					}
				>
					{(src) => <img class="grid-cell__image-thumb" src={src()} alt="" loading="lazy" decoding="async" />}
				</Show>

				<Show when={jsonExpanded()}>
					<div class="grid-cell__json-popup" onClick={(e) => e.stopPropagation()}>
						<pre>{formatJsonValue(props.value, true)}</pre>
					</div>
				</Show>
			</div>
		</Show>
	)
}
