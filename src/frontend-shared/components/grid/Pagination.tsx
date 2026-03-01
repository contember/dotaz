import { For, Show } from "solid-js";
import ChevronsLeft from "lucide-solid/icons/chevrons-left";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronsRight from "lucide-solid/icons/chevrons-right";
import "./Pagination.css";

interface PaginationProps {
	currentPage: number;
	pageSize: number;
	totalCount: number;
	loading: boolean;
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [25, 50, 100, 250, 500];

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}

	const pages: (number | "...")[] = [1];

	if (current > 3) {
		pages.push("...");
	}

	const start = Math.max(2, current - 1);
	const end = Math.min(total - 1, current + 1);

	for (let i = start; i <= end; i++) {
		pages.push(i);
	}

	if (current < total - 2) {
		pages.push("...");
	}

	if (total > 1) {
		pages.push(total);
	}

	return pages;
}

export default function Pagination(props: PaginationProps) {
	const totalPages = () => Math.max(1, Math.ceil(props.totalCount / props.pageSize));
	const rangeStart = () => props.totalCount === 0 ? 0 : (props.currentPage - 1) * props.pageSize + 1;
	const rangeEnd = () => Math.min(props.currentPage * props.pageSize, props.totalCount);
	const isFirst = () => props.currentPage <= 1;
	const isLast = () => props.currentPage >= totalPages();

	return (
		<div class="pagination">
			<span class="pagination__info">
				<Show
					when={props.totalCount >= 0 && !props.loading}
					fallback={<>counting...</>}
				>
					Showing {formatNumber(rangeStart())}–{formatNumber(rangeEnd())} of {formatNumber(props.totalCount)} rows
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
							when={typeof page === "number"}
							fallback={<span class="pagination__btn" style={{ cursor: "default" }}>…</span>}
						>
							<button
								class="pagination__btn"
								classList={{ "pagination__btn--active": page === props.currentPage }}
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
				<select
					value={props.pageSize}
					onChange={(e) => props.onPageSizeChange(Number(e.currentTarget.value))}
				>
					<For each={PAGE_SIZES}>
						{(size) => <option value={size}>{size}</option>}
					</For>
				</select>
			</div>
		</div>
	);
}
