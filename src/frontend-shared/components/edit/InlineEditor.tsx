import { createSignal, onMount } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import { isNumericType, isBooleanType, isDateType, isTextType } from "../../lib/column-types";
import "./InlineEditor.css";

interface InlineEditorProps {
	value: unknown;
	column: GridColumnDef;
	width: number;
	onSave: (value: unknown) => void;
	onCancel: () => void;
	onMoveNext: () => void;
	onMoveDown: () => void;
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function parseValue(text: string, column: GridColumnDef): unknown {
	if (text === "") return column.nullable ? null : text;

	if (isNumericType(column.dataType)) {
		const n = Number(text);
		return Number.isNaN(n) ? text : n;
	}

	if (isBooleanType(column.dataType)) {
		const lower = text.toLowerCase();
		if (lower === "true" || lower === "1" || lower === "t") return true;
		if (lower === "false" || lower === "0" || lower === "f") return false;
		return text;
	}

	return text;
}

export default function InlineEditor(props: InlineEditorProps) {
	const [isNull, setIsNull] = createSignal(
		props.value === null || props.value === undefined,
	);
	let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined;

	const dataType = () => props.column.dataType;
	const isBool = () => isBooleanType(dataType());
	const isDate = () => isDateType(dataType());
	const isNum = () => isNumericType(dataType());
	const isText = () => isTextType(dataType());

	onMount(() => {
		if (inputRef) {
			inputRef.focus();
			if ("select" in inputRef) {
				inputRef.select();
			}
		}
	});

	function save() {
		if (isNull()) {
			props.onSave(null);
			return;
		}
		if (isBool()) {
			// Checkbox value is handled in handleCheckboxChange
			return;
		}
		if (inputRef) {
			const parsed = parseValue(inputRef.value, props.column);
			props.onSave(parsed);
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			props.onCancel();
		} else if (e.key === "Tab") {
			e.preventDefault();
			e.stopPropagation();
			save();
			props.onMoveNext();
		} else if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			save();
			props.onMoveDown();
		}
	}

	function handleCheckboxChange(e: Event) {
		const checked = (e.target as HTMLInputElement).checked;
		props.onSave(checked);
	}

	function handleSetNull() {
		setIsNull(true);
		props.onSave(null);
	}

	// Date formatting for input[type=date]/input[type=datetime-local]
	function dateInputValue(): string {
		if (isNull() || props.value === null || props.value === undefined) return "";
		const str = String(props.value);
		if (dataType().toLowerCase() === "date") {
			// Return YYYY-MM-DD
			return str.substring(0, 10);
		}
		// datetime-local expects YYYY-MM-DDTHH:mm:ss
		const d = new Date(str);
		if (Number.isNaN(d.getTime())) return str;
		return d.toISOString().substring(0, 19);
	}

	if (isBool()) {
		return (
			<div
				class="inline-editor inline-editor--boolean"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<input
					ref={(el) => { inputRef = el; }}
					type="checkbox"
					checked={!!props.value && !isNull()}
					onChange={handleCheckboxChange}
				/>
				{props.column.nullable && (
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
			</div>
		);
	}

	if (isDate()) {
		const inputType = dataType().toLowerCase() === "date" ? "date" : "datetime-local";
		return (
			<div
				class="inline-editor inline-editor--date"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<input
					ref={(el) => { inputRef = el; }}
					type={inputType}
					value={dateInputValue()}
					onBlur={() => save()}
				/>
				{props.column.nullable && (
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
			</div>
		);
	}

	if (isNum()) {
		return (
			<div
				class="inline-editor inline-editor--number"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<input
					ref={(el) => { inputRef = el; }}
					type="text"
					inputMode="numeric"
					value={isNull() ? "" : valueToString(props.value)}
					onBlur={() => save()}
				/>
				{props.column.nullable && (
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
			</div>
		);
	}

	// Default: text input (or textarea for text/varchar types)
	if (isText()) {
		return (
			<div
				class="inline-editor inline-editor--text"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<textarea
					ref={(el) => { inputRef = el; }}
					value={isNull() ? "" : valueToString(props.value)}
					onBlur={() => save()}
					rows={1}
					onInput={(e) => {
						const el = e.target as HTMLTextAreaElement;
						el.style.height = "auto";
						el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
					}}
				/>
				{props.column.nullable && (
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
			</div>
		);
	}

	// Generic fallback
	return (
		<div
			class="inline-editor"
			style={{ width: `${props.width}px` }}
			onKeyDown={handleKeyDown}
		>
			<input
				ref={(el) => { inputRef = el; }}
				type="text"
				value={isNull() ? "" : valueToString(props.value)}
				onBlur={() => save()}
			/>
			{props.column.nullable && (
				<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
					NULL
				</button>
			)}
		</div>
	);
}
