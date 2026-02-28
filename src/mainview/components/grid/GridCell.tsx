import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import "./GridCell.css";

interface GridCellProps {
	value: unknown;
	column: GridColumnDef;
	width: number;
	pinStyle?: Record<string, string>;
}

function isNumericType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return (
		t.includes("int") ||
		t.includes("numeric") ||
		t.includes("decimal") ||
		t.includes("float") ||
		t.includes("double") ||
		t.includes("real") ||
		t.includes("serial")
	);
}

function isBooleanType(dataType: string): boolean {
	return dataType.toLowerCase().includes("bool");
}

function isTimestampType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return t.includes("timestamp") || t === "date" || t === "datetime";
}

function isJsonType(dataType: string): boolean {
	return dataType.toLowerCase().includes("json");
}

function formatTimestamp(value: unknown): string {
	if (value instanceof Date) {
		return formatDate(value);
	}
	if (typeof value === "string") {
		const d = new Date(value);
		if (!Number.isNaN(d.getTime())) {
			return formatDate(d);
		}
	}
	return String(value);
}

function formatDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function GridCell(props: GridCellProps) {
	const [jsonExpanded, setJsonExpanded] = createSignal(false);

	const isNull = () => props.value === null || props.value === undefined;
	const isNumber = () => isNumericType(props.column.dataType);
	const isBool = () => isBooleanType(props.column.dataType);
	const isTs = () => isTimestampType(props.column.dataType);
	const isJson = () => isJsonType(props.column.dataType);

	const displayValue = () => {
		if (isNull()) return "NULL";
		if (isBool()) return props.value ? "\u2713" : "\u2717";
		if (isTs()) return formatTimestamp(props.value);
		if (isJson() && typeof props.value === "object")
			return JSON.stringify(props.value);
		return String(props.value);
	};

	const tooltipValue = (): string | undefined => {
		if (isNull()) return undefined;
		if (isJson() && typeof props.value === "object")
			return JSON.stringify(props.value, null, 2);
		const str = String(props.value);
		return str.length > 50 ? str : undefined;
	};

	function handleJsonClick(e: MouseEvent) {
		if (!isJson() || isNull()) return;
		e.stopPropagation();
		setJsonExpanded(!jsonExpanded());
	}

	createEffect(() => {
		if (jsonExpanded()) {
			const handler = (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				if (!target.closest(".grid-cell__json-popup")) {
					setJsonExpanded(false);
				}
			};
			document.addEventListener("click", handler);
			onCleanup(() => document.removeEventListener("click", handler));
		}
	});

	return (
		<div
			class="grid-cell"
			classList={{
				"grid-cell--null": isNull(),
				"grid-cell--number": isNumber() && !isNull(),
				"grid-cell--boolean": isBool() && !isNull(),
				"grid-cell--json": isJson() && !isNull(),
				"grid-cell--timestamp": isTs() && !isNull(),
			}}
			style={{ width: `${props.width}px`, ...props.pinStyle }}
			title={tooltipValue()}
			data-column={props.column.name}
			onClick={isJson() && !isNull() ? handleJsonClick : undefined}
		>
			{displayValue()}

			<Show when={jsonExpanded()}>
				<div class="grid-cell__json-popup" onClick={(e) => e.stopPropagation()}>
					<pre>{JSON.stringify(props.value, null, 2)}</pre>
				</div>
			</Show>
		</div>
	);
}
