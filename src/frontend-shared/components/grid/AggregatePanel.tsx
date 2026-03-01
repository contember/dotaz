import { createMemo, For, Show } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import { isNumericType, isDateType, isTextType } from "../../lib/column-types";
import "./AggregatePanel.css";

export interface AggregateResult {
	column: string;
	count: number;
	countDistinct: number;
	sum?: number;
	avg?: number;
	min?: number | string;
	max?: number | string;
}

interface AggregatePanelProps {
	rows: Record<string, unknown>[];
	columns: GridColumnDef[];
	visibleColumns: GridColumnDef[];
}

function formatNumber(value: number): string {
	if (Number.isInteger(value)) {
		return value.toLocaleString();
	}
	// Up to 4 decimal places, strip trailing zeros
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 4,
	});
}

function computeAggregates(
	rows: Record<string, unknown>[],
	columns: GridColumnDef[],
): AggregateResult[] {
	const results: AggregateResult[] = [];

	for (const col of columns) {
		const values: unknown[] = [];
		for (const row of rows) {
			const v = row[col.name];
			if (v !== null && v !== undefined) {
				values.push(v);
			}
		}

		const count = values.length;
		const distinct = new Set(values.map((v) => String(v))).size;
		const result: AggregateResult = {
			column: col.name,
			count,
			countDistinct: distinct,
		};

		if (isNumericType(col.dataType)) {
			const nums = values.map(Number).filter((n) => !Number.isNaN(n));
			if (nums.length > 0) {
				result.sum = nums.reduce((a, b) => a + b, 0);
				result.avg = result.sum / nums.length;
				result.min = Math.min(...nums);
				result.max = Math.max(...nums);
			}
		} else if (isDateType(col.dataType) || isTextType(col.dataType)) {
			const strings = values.map(String).sort();
			if (strings.length > 0) {
				result.min = strings[0];
				result.max = strings[strings.length - 1];
			}
		}

		results.push(result);
	}

	return results;
}

export default function AggregatePanel(props: AggregatePanelProps) {
	const aggregates = createMemo(() =>
		computeAggregates(props.rows, props.visibleColumns),
	);

	const hasAnyData = createMemo(() =>
		aggregates().some((a) => a.count > 0),
	);

	return (
		<Show when={hasAnyData()}>
			<div class="aggregate-panel">
				<div class="aggregate-panel__label">
					{props.rows.length} row{props.rows.length !== 1 ? "s" : ""}
				</div>
				<div class="aggregate-panel__items">
					<For each={aggregates()}>
						{(agg) => {
							const col = props.visibleColumns.find((c) => c.name === agg.column);
							if (!col || agg.count === 0) return null;
							const numeric = isNumericType(col.dataType);
							const text = isTextType(col.dataType);
							const date = isDateType(col.dataType);

							return (
								<div class="aggregate-panel__column">
									<span class="aggregate-panel__column-name">{agg.column}</span>
									<span class="aggregate-panel__stat">
										CNT: <b>{agg.count}</b>
									</span>
									<Show when={text || date}>
										<span class="aggregate-panel__stat">
											DST: <b>{agg.countDistinct}</b>
										</span>
									</Show>
									<Show when={numeric && agg.sum !== undefined}>
										<span class="aggregate-panel__stat">
											SUM: <b>{formatNumber(agg.sum!)}</b>
										</span>
									</Show>
									<Show when={numeric && agg.avg !== undefined}>
										<span class="aggregate-panel__stat">
											AVG: <b>{formatNumber(agg.avg!)}</b>
										</span>
									</Show>
									<Show when={agg.min !== undefined}>
										<span class="aggregate-panel__stat">
											MIN: <b>{typeof agg.min === "number" ? formatNumber(agg.min) : agg.min}</b>
										</span>
									</Show>
									<Show when={agg.max !== undefined}>
										<span class="aggregate-panel__stat">
											MAX: <b>{typeof agg.max === "number" ? formatNumber(agg.max) : agg.max}</b>
										</span>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
			</div>
		</Show>
	);
}
