import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import ChevronsLeft from 'lucide-solid/icons/chevrons-left'
import ChevronsRight from 'lucide-solid/icons/chevrons-right'
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import Select from '../common/Select'
import './Pagination.css'

interface PaginationProps {
	currentPage: number
	pageSize: number
	totalCount: number
	loading: boolean
	lastLoadedAt?: number | null
	fetchDuration?: number | null
	onPageChange: (page: number) => void
	onPageSizeChange: (size: number) => void
}

const PAGE_SIZES = [25, 50, 100, 250, 500]

function formatNumber(n: number): string {
	return n.toLocaleString()
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => i + 1)
	}

	const pages: (number | '...')[] = [1]

	if (current > 3) {
		pages.push('...')
	}

	const start = Math.max(2, current - 1)
	const end = Math.min(total - 1, current + 1)

	for (let i = start; i <= end; i++) {
		pages.push(i)
	}

	if (current < total - 2) {
		pages.push('...')
	}

	if (total > 1) {
		pages.push(total)
	}

	return pages
}

function formatAgo(elapsedMs: number): string {
	if (elapsedMs < 5_000) return 'just now'
	if (elapsedMs < 60_000) return `${Math.floor(elapsedMs / 1000)}s ago`
	if (elapsedMs < 3600_000) return `${Math.floor(elapsedMs / 60_000)}m ago`
	return `${Math.floor(elapsedMs / 3600_000)}h ago`
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

export default function Pagination(props: PaginationProps) {
	const totalPages = () => Math.max(1, Math.ceil(props.totalCount / props.pageSize))
	const rangeStart = () => props.totalCount === 0 ? 0 : (props.currentPage - 1) * props.pageSize + 1
	const rangeEnd = () => Math.min(props.currentPage * props.pageSize, props.totalCount)
	const isFirst = () => props.currentPage <= 1
	const isLast = () => props.currentPage >= totalPages()

	// Live-updating "fetched ago" timer
	const [now, setNow] = createSignal(Date.now())
	const timer = setInterval(() => setNow(Date.now()), 1000)
	onCleanup(() => clearInterval(timer))

	const fetchedAgo = createMemo(() => {
		if (props.lastLoadedAt == null) return null
		return formatAgo(now() - props.lastLoadedAt)
	})

	const duration = createMemo(() => {
		if (props.fetchDuration == null) return null
		return formatDuration(props.fetchDuration)
	})

	return (
		<div class="pagination">
			<span class="pagination__info">
				<Show
					when={props.totalCount >= 0 && !props.loading}
					fallback={<>counting...</>}
				>
					Showing {formatNumber(rangeStart())}–{formatNumber(rangeEnd())} of {formatNumber(props.totalCount)} rows
				</Show>
				<Show when={fetchedAgo() && !props.loading}>
					<span class="pagination__fetch-info">
						{' · '}fetched {fetchedAgo()}
						<Show when={duration()}>
							{' '}({duration()})
						</Show>
					</span>
				</Show>
			</span>

			<div class="pagination__nav">
				<button
					class="pagination__btn"
					disabled={isFirst()}
					onClick={() => props.onPageChange(1)}
					title="First page"
				>
					<ChevronsLeft size={14} />
				</button>
				<button
					class="pagination__btn"
					disabled={isFirst()}
					onClick={() => props.onPageChange(props.currentPage - 1)}
					title="Previous page"
				>
					<ChevronLeft size={14} />
				</button>

				<For each={getPageNumbers(props.currentPage, totalPages())}>
					{(page) => (
						<Show
							when={typeof page === 'number'}
							fallback={<span class="pagination__btn" style={{ cursor: 'default' }}>…</span>}
						>
							<button
								class="pagination__btn"
								classList={{ 'pagination__btn--active': page === props.currentPage }}
								onClick={() => props.onPageChange(page as number)}
							>
								{page}
							</button>
						</Show>
					)}
				</For>

				<button
					class="pagination__btn"
					disabled={isLast()}
					onClick={() => props.onPageChange(props.currentPage + 1)}
					title="Next page"
				>
					<ChevronRight size={14} />
				</button>
				<button
					class="pagination__btn"
					disabled={isLast()}
					onClick={() => props.onPageChange(totalPages())}
					title="Last page"
				>
					<ChevronsRight size={14} />
				</button>
			</div>

			<div class="pagination__size">
				<span>Rows:</span>
				<Select
					value={String(props.pageSize)}
					onChange={(v) => props.onPageSizeChange(Number(v))}
					options={PAGE_SIZES.map(s => ({ value: String(s), label: String(s) }))}
				/>
			</div>
		</div>
	)
}
