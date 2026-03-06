import CalendarIcon from 'lucide-solid/icons/calendar'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import X from 'lucide-solid/icons/x'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import './DateInput.css'

interface DateInputProps {
	value: string
	onChange: (value: string) => void
	mode?: 'date' | 'datetime'
	class?: string
	disabled?: boolean
	readOnly?: boolean
	title?: string
	placeholder?: string
	onBlur?: () => void
	onKeyDown?: (e: KeyboardEvent) => void
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parseDateValue(value: string): { year: number; month: number; day: number; hours: number; minutes: number; seconds: number } | null {
	// Match YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD HH:mm:ss
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
	if (!m) return null
	return {
		year: Number(m[1]),
		month: Number(m[2]) - 1,
		day: Number(m[3]),
		hours: m[4] != null ? Number(m[4]) : 0,
		minutes: m[5] != null ? Number(m[5]) : 0,
		seconds: m[6] != null ? Number(m[6]) : 0,
	}
}

function formatDate(year: number, month: number, day: number): string {
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatDateTime(year: number, month: number, day: number, hours: number, minutes: number, seconds: number): string {
	return `${formatDate(year, month, day)}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function DateInput(props: DateInputProps) {
	let wrapperRef: HTMLDivElement | undefined
	const [open, setOpen] = createSignal(false)
	const [above, setAbove] = createSignal(false)
	const [timeHours, setTimeHours] = createSignal(0)
	const [timeMinutes, setTimeMinutes] = createSignal(0)
	const [timeSeconds, setTimeSeconds] = createSignal(0)

	const isDateTime = () => props.mode === 'datetime'
	const parsed = createMemo(() => parseDateValue(props.value))

	const [viewYear, setViewYear] = createSignal(new Date().getFullYear())
	const [viewMonth, setViewMonth] = createSignal(new Date().getMonth())

	function displayValue(): string {
		if (!props.value) return ''
		const p = parsed()
		if (!p) return props.value
		if (isDateTime()) {
			return `${formatDate(p.year, p.month, p.day)} ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}:${String(p.seconds).padStart(2, '0')}`
		}
		return formatDate(p.year, p.month, p.day)
	}

	function openCalendar() {
		if (props.disabled || props.readOnly) return
		const p = parsed()
		if (p) {
			setViewYear(p.year)
			setViewMonth(p.month)
			setTimeHours(p.hours)
			setTimeMinutes(p.minutes)
			setTimeSeconds(p.seconds)
		} else {
			const now = new Date()
			setViewYear(now.getFullYear())
			setViewMonth(now.getMonth())
			setTimeHours(0)
			setTimeMinutes(0)
			setTimeSeconds(0)
		}
		setOpen(true)
		positionDropdown()
	}

	function positionDropdown() {
		if (!wrapperRef) return
		const rect = wrapperRef.getBoundingClientRect()
		const spaceBelow = window.innerHeight - rect.bottom
		const dropdownHeight = isDateTime() ? 320 : 280
		setAbove(spaceBelow < dropdownHeight && rect.top > spaceBelow)
	}

	function close() {
		setOpen(false)
		props.onBlur?.()
	}

	function emitValue(year: number, month: number, day: number) {
		if (isDateTime()) {
			props.onChange(formatDateTime(year, month, day, timeHours(), timeMinutes(), timeSeconds()))
		} else {
			props.onChange(formatDate(year, month, day))
		}
	}

	function selectDay(day: number) {
		emitValue(viewYear(), viewMonth(), day)
		if (!isDateTime()) {
			close()
		}
	}

	function handleTimeChange(field: 'h' | 'm' | 's', value: string) {
		const num = Math.max(0, Math.min(field === 'h' ? 23 : 59, Number(value) || 0))
		if (field === 'h') setTimeHours(num)
		else if (field === 'm') setTimeMinutes(num)
		else setTimeSeconds(num)

		// Re-emit with updated time if we have a selected date
		const p = parsed()
		if (p) {
			const h = field === 'h' ? num : timeHours()
			const m = field === 'm' ? num : timeMinutes()
			const s = field === 's' ? num : timeSeconds()
			props.onChange(formatDateTime(p.year, p.month, p.day, h, m, s))
		}
	}

	function clear(e: MouseEvent) {
		e.stopPropagation()
		props.onChange('')
		close()
	}

	function prevMonth() {
		if (viewMonth() === 0) {
			setViewMonth(11)
			setViewYear(viewYear() - 1)
		} else {
			setViewMonth(viewMonth() - 1)
		}
	}

	function nextMonth() {
		if (viewMonth() === 11) {
			setViewMonth(0)
			setViewYear(viewYear() + 1)
		} else {
			setViewMonth(viewMonth() + 1)
		}
	}

	const calendarDays = createMemo(() => {
		const year = viewYear()
		const month = viewMonth()
		const firstDay = new Date(year, month, 1).getDay()
		const startOffset = (firstDay + 6) % 7
		const daysInMonth = new Date(year, month + 1, 0).getDate()

		const days: (number | null)[] = []
		for (let i = 0; i < startOffset; i++) days.push(null)
		for (let d = 1; d <= daysInMonth; d++) days.push(d)
		return days
	})

	function isSelected(day: number): boolean {
		const p = parsed()
		if (!p) return false
		return p.year === viewYear() && p.month === viewMonth() && p.day === day
	}

	function isToday(day: number): boolean {
		const now = new Date()
		return now.getFullYear() === viewYear() && now.getMonth() === viewMonth() && now.getDate() === day
	}

	function handleClickOutside(e: MouseEvent) {
		if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
			if (open()) {
				close()
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open()) {
			e.preventDefault()
			close()
			return
		}
		props.onKeyDown?.(e)
	}

	onMount(() => {
		document.addEventListener('mousedown', handleClickOutside)
	})

	onCleanup(() => {
		document.removeEventListener('mousedown', handleClickOutside)
	})

	return (
		<div
			ref={wrapperRef}
			class={`date-input ${props.class ?? ''}`}
			classList={{
				'date-input--disabled': props.disabled,
				'date-input--readonly': props.readOnly,
			}}
			onKeyDown={handleKeyDown}
		>
			<button
				type="button"
				class="date-input__trigger"
				disabled={props.disabled}
				title={props.title}
				onClick={() => open() ? close() : openCalendar()}
			>
				<CalendarIcon size={12} class="date-input__icon" />
				<span class="date-input__value" classList={{ 'date-input__value--placeholder': !props.value }}>
					{displayValue() || props.placeholder || 'Select date'}
				</span>
				<Show when={props.value && !props.readOnly}>
					<button type="button" class="date-input__clear" onClick={clear} title="Clear date">
						<X size={10} />
					</button>
				</Show>
			</button>
			{open() && (
				<div class="date-input__dropdown" classList={{ 'date-input__dropdown--above': above() }}>
					<div class="date-input__header">
						<button type="button" class="date-input__nav" onClick={prevMonth}>
							<ChevronLeft size={14} />
						</button>
						<span class="date-input__month-year">
							{MONTHS[viewMonth()]} {viewYear()}
						</span>
						<button type="button" class="date-input__nav" onClick={nextMonth}>
							<ChevronRight size={14} />
						</button>
					</div>
					<div class="date-input__weekdays">
						<For each={DAYS}>{(d) => <span class="date-input__weekday">{d}</span>}</For>
					</div>
					<div class="date-input__grid">
						<For each={calendarDays()}>
							{(day) => (
								<Show when={day !== null} fallback={<span class="date-input__empty" />}>
									<button
										type="button"
										class="date-input__day"
										classList={{
											'date-input__day--selected': isSelected(day!),
											'date-input__day--today': isToday(day!),
										}}
										onClick={() => selectDay(day!)}
									>
										{day}
									</button>
								</Show>
							)}
						</For>
					</div>
					<Show when={isDateTime()}>
						<div class="date-input__time">
							<input
								type="number"
								class="date-input__time-field"
								min={0}
								max={23}
								value={timeHours()}
								onInput={(e) => handleTimeChange('h', e.currentTarget.value)}
								title="Hours"
							/>
							<span class="date-input__time-sep">:</span>
							<input
								type="number"
								class="date-input__time-field"
								min={0}
								max={59}
								value={timeMinutes()}
								onInput={(e) => handleTimeChange('m', e.currentTarget.value)}
								title="Minutes"
							/>
							<span class="date-input__time-sep">:</span>
							<input
								type="number"
								class="date-input__time-field"
								min={0}
								max={59}
								value={timeSeconds()}
								onInput={(e) => handleTimeChange('s', e.currentTarget.value)}
								title="Seconds"
							/>
							<button type="button" class="date-input__time-done" onClick={close}>
								Done
							</button>
						</div>
					</Show>
				</div>
			)}
		</div>
	)
}
