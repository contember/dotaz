import { createSignal, For, Show } from "solid-js";
import type {
	ColumnFilter,
	FilterOperator,
	GridColumnDef,
} from "../../../shared/types/grid";
import { X, FilterX, Plus } from "lucide-solid";
import "./FilterBar.css";

interface FilterBarProps {
	columns: GridColumnDef[];
	filters: ColumnFilter[];
	onAddFilter: (filter: ColumnFilter) => void;
	onRemoveFilter: (column: string) => void;
	onClearAll: () => void;
}

interface OperatorOption {
	value: FilterOperator;
	label: string;
}

const ALL_OPERATORS: OperatorOption[] = [
	{ value: "eq", label: "=" },
	{ value: "neq", label: "!=" },
	{ value: "gt", label: ">" },
	{ value: "gte", label: ">=" },
	{ value: "lt", label: "<" },
	{ value: "lte", label: "<=" },
	{ value: "like", label: "LIKE" },
	{ value: "in", label: "IN" },
	{ value: "isNull", label: "IS NULL" },
	{ value: "isNotNull", label: "IS NOT NULL" },
];

function getColumnCategory(dataType: string): "text" | "number" | "boolean" | "other" {
	const t = dataType.toLowerCase();
	if (t.includes("bool")) return "boolean";
	if (
		t.includes("int") ||
		t.includes("serial") ||
		t.includes("numeric") ||
		t.includes("decimal") ||
		t.includes("float") ||
		t.includes("double") ||
		t.includes("real")
	)
		return "number";
	if (
		t.includes("text") ||
		t.includes("varchar") ||
		t.includes("char") ||
		t.includes("name")
	)
		return "text";
	return "other";
}

function getOperatorsForType(dataType: string): OperatorOption[] {
	const category = getColumnCategory(dataType);
	switch (category) {
		case "boolean":
			return ALL_OPERATORS.filter((o) =>
				["eq", "neq", "isNull", "isNotNull"].includes(o.value),
			);
		case "number":
			return ALL_OPERATORS.filter((o) => o.value !== "like");
		case "text":
			return ALL_OPERATORS;
		default:
			return ALL_OPERATORS;
	}
}

function operatorNeedsValue(op: FilterOperator): boolean {
	return op !== "isNull" && op !== "isNotNull";
}

function operatorLabel(op: FilterOperator): string {
	return ALL_OPERATORS.find((o) => o.value === op)?.label ?? op;
}

function formatFilterValue(filter: ColumnFilter): string {
	if (!operatorNeedsValue(filter.operator)) return "";
	if (filter.operator === "in" && Array.isArray(filter.value)) {
		return (filter.value as unknown[]).join(", ");
	}
	return String(filter.value ?? "");
}

export default function FilterBar(props: FilterBarProps) {
	const [adding, setAdding] = createSignal(false);
	const [selectedColumn, setSelectedColumn] = createSignal("");
	const [selectedOperator, setSelectedOperator] = createSignal<FilterOperator>("eq");
	const [inputValue, setInputValue] = createSignal("");

	function availableColumns() {
		const filtered = new Set(props.filters.map((f) => f.column));
		return props.columns.filter((c) => !filtered.has(c.name));
	}

	function currentColumnDef(): GridColumnDef | undefined {
		return props.columns.find((c) => c.name === selectedColumn());
	}

	function currentOperators(): OperatorOption[] {
		const col = currentColumnDef();
		if (!col) return ALL_OPERATORS;
		return getOperatorsForType(col.dataType);
	}

	function resetForm() {
		setSelectedColumn("");
		setSelectedOperator("eq");
		setInputValue("");
		setAdding(false);
	}

	function handleColumnChange(name: string) {
		setSelectedColumn(name);
		setInputValue("");
		const col = props.columns.find((c) => c.name === name);
		if (col) {
			const ops = getOperatorsForType(col.dataType);
			if (!ops.find((o) => o.value === selectedOperator())) {
				setSelectedOperator(ops[0].value);
			}
		}
	}

	function handleApply() {
		const col = selectedColumn();
		const op = selectedOperator();
		if (!col) return;

		let value: unknown = null;
		if (operatorNeedsValue(op)) {
			const raw = inputValue().trim();
			if (!raw) return;
			if (op === "in") {
				value = raw.split(",").map((v) => v.trim());
			} else {
				value = raw;
			}
		}

		props.onAddFilter({ column: col, operator: op, value });
		resetForm();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			handleApply();
		} else if (e.key === "Escape") {
			resetForm();
		}
	}

	return (
		<div class="filter-bar">
			<div class="filter-bar__chips">
				<For each={props.filters}>
					{(filter) => (
						<span class="filter-bar__chip">
							<span class="filter-bar__chip-col">{filter.column}</span>
							<span class="filter-bar__chip-op">{operatorLabel(filter.operator)}</span>
							<Show when={operatorNeedsValue(filter.operator)}>
								<span class="filter-bar__chip-val">{formatFilterValue(filter)}</span>
							</Show>
							<button
								class="filter-bar__chip-remove"
								onClick={() => props.onRemoveFilter(filter.column)}
								title="Remove filter"
							>
								<X size={12} />
							</button>
						</span>
					)}
				</For>

				<Show when={props.filters.length > 1}>
					<button class="filter-bar__clear-all" onClick={props.onClearAll}>
						<FilterX size={12} /> Clear All
					</button>
				</Show>
			</div>

			<Show
				when={adding()}
				fallback={
					<Show when={availableColumns().length > 0}>
						<button class="filter-bar__add-btn" onClick={() => setAdding(true)}>
							<Plus size={12} /> Add Filter
						</button>
					</Show>
				}
			>
				<div class="filter-bar__form">
					<select
						class="filter-bar__select"
						value={selectedColumn()}
						onChange={(e) => handleColumnChange(e.currentTarget.value)}
					>
						<option value="">Column...</option>
						<For each={availableColumns()}>
							{(col) => <option value={col.name}>{col.name}</option>}
						</For>
					</select>

					<select
						class="filter-bar__select"
						value={selectedOperator()}
						onChange={(e) => setSelectedOperator(e.currentTarget.value as FilterOperator)}
					>
						<For each={currentOperators()}>
							{(op) => <option value={op.value}>{op.label}</option>}
						</For>
					</select>

					<Show when={operatorNeedsValue(selectedOperator())}>
						<input
							class="filter-bar__input"
							type="text"
							placeholder={selectedOperator() === "in" ? "val1, val2, ..." : "Value..."}
							value={inputValue()}
							onInput={(e) => setInputValue(e.currentTarget.value)}
							onKeyDown={handleKeyDown}
						/>
					</Show>

					<button
						class="filter-bar__apply-btn"
						onClick={handleApply}
						disabled={!selectedColumn() || (operatorNeedsValue(selectedOperator()) && !inputValue().trim())}
					>
						Apply
					</button>
					<button class="filter-bar__cancel-btn" onClick={resetForm}>
						Cancel
					</button>
				</div>
			</Show>
		</div>
	);
}
