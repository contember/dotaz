import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import { isSqlDefault } from "../../../shared/types/database";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import InlineEditor from "../edit/InlineEditor";
import { isNumericType, isBooleanType, isTimestampType, isJsonType } from "../../lib/column-types";
import "./GridCell.css";

interface GridCellProps {
	value: unknown;
	column: GridColumnDef;
	width: number;
	pinStyle?: Record<string, string>;
	editing?: boolean;
	changed?: boolean;
	deleted?: boolean;
	newRow?: boolean;
	/** FK target info for this column (if it's a single-column FK). */
	fkTarget?: { schema: string; table: string; column: string };
	/** Background color for heatmap visualization. */
	heatmapColor?: string;
	onSave?: (value: unknown) => void;
	onCancel?: () => void;
	onMoveNext?: () => void;
	onMoveDown?: () => void;
	onFkClick?: () => void;
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
	const isDefault = () => isSqlDefault(props.value);
	const isNumber = () => isNumericType(props.column.dataType);
	const isBool = () => isBooleanType(props.column.dataType);
	const isTs = () => isTimestampType(props.column.dataType);
	const isJson = () => isJsonType(props.column.dataType);

	const displayValue = () => {
		if (isDefault()) return "DEFAULT";
		if (isNull()) return "NULL";
		if (isBool()) return props.value ? <Check size={14} /> : <X size={14} />;
		if (isTs()) return formatTimestamp(props.value);
		if (isJson() && typeof props.value === "object")
			return JSON.stringify(props.value);
		return String(props.value);
	};

	const isFk = () => !!props.fkTarget && !isNull();

	const tooltipValue = (): string | undefined => {
		if (props.fkTarget && !isNull()) {
			return `\u2192 ${props.fkTarget.table}.${props.fkTarget.column}`;
		}
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

	function handleFkClick(e: MouseEvent) {
		e.stopPropagation();
		props.onFkClick?.();
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
					"grid-cell--null": isNull(),
					"grid-cell--default": isDefault(),
					"grid-cell--number": isNumber() && !isNull() && !isDefault(),
					"grid-cell--boolean": isBool() && !isNull() && !isDefault(),
					"grid-cell--json": isJson() && !isNull() && !isDefault(),
					"grid-cell--timestamp": isTs() && !isNull() && !isDefault(),
					"grid-cell--fk": isFk(),
					"grid-cell--changed": !!props.changed,
					"grid-cell--deleted": !!props.deleted,
					"grid-cell--new-row": !!props.newRow,
				}}
				style={{
				width: `${props.width}px`,
				...props.pinStyle,
				...(props.heatmapColor ? { "background-color": props.heatmapColor } : {}),
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
	);
}
