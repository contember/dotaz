import { createSignal, For, Show } from "solid-js";
import type { GridColumnDef } from "../../../shared/types/grid";
import type { ForeignKeyInfo } from "../../../shared/types/database";
import { ChevronUp, ChevronDown } from "lucide-solid";
import Dialog from "../common/Dialog";
import "./RowDetailDialog.css";

interface RowDetailDialogProps {
	open: boolean;
	tabId: string;
	/** All columns in the table. */
	columns: GridColumnDef[];
	/** All rows in the current page. */
	rows: Record<string, unknown>[];
	/** Current row index within rows array. */
	rowIndex: number;
	/** FK info for the table. */
	foreignKeys: ForeignKeyInfo[];
	/** Which cells already have pending changes (keyed "rowIndex:column"). */
	pendingCellEdits: Record<string, { oldValue: unknown }>;
	onSave: (rowIndex: number, changes: Record<string, unknown>) => void;
	onClose: () => void;
	onNavigate: (rowIndex: number) => void;
}

// ── Type helpers (shared with InlineEditor) ──────────────

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

function isDateType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return t.includes("timestamp") || t === "date" || t === "datetime";
}

function isTextType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return t === "text" || t.includes("varchar") || t.includes("char") || t.includes("clob");
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value, null, 2);
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

function dateInputValue(value: unknown, dataType: string): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	if (dataType.toLowerCase() === "date") {
		return str.substring(0, 10);
	}
	const d = new Date(str);
	if (Number.isNaN(d.getTime())) return str;
	return d.toISOString().substring(0, 19);
}

export default function RowDetailDialog(props: RowDetailDialogProps) {
	// Local form state: column -> value (edited values for this dialog session)
	const [localEdits, setLocalEdits] = createSignal<Record<string, unknown>>({});
	const [currentIndex, setCurrentIndex] = createSignal(props.rowIndex);

	// Build FK lookup: column name -> ForeignKeyInfo
	const fkMap = () => {
		const map = new Map<string, ForeignKeyInfo>();
		for (const fk of props.foreignKeys) {
			for (const col of fk.columns) {
				map.set(col, fk);
			}
		}
		return map;
	};

	const pkColumns = () => new Set(props.columns.filter((c) => c.isPrimaryKey).map((c) => c.name));

	const currentRow = () => props.rows[currentIndex()];

	// Get the effective value for a column: local edit > current row data
	function getValue(column: string): unknown {
		const edits = localEdits();
		if (column in edits) return edits[column];
		const row = currentRow();
		return row ? row[column] : null;
	}

	function isFieldNull(column: string): boolean {
		const v = getValue(column);
		return v === null || v === undefined;
	}

	function isChanged(column: string): boolean {
		// Changed in this dialog session
		if (column in localEdits()) return true;
		// Already changed in pending changes
		const key = `${currentIndex()}:${column}`;
		return key in props.pendingCellEdits;
	}

	function setFieldValue(column: string, value: unknown) {
		setLocalEdits((prev) => ({ ...prev, [column]: value }));
	}

	function setNull(column: string) {
		setFieldValue(column, null);
	}

	// ── Dialog title ──────────────────────────────────────────

	function dialogTitle(): string {
		const row = currentRow();
		if (!row) return "Row Detail";
		const pks = pkColumns();
		if (pks.size === 0) return `Row ${currentIndex() + 1}`;
		const parts: string[] = [];
		for (const pk of pks) {
			const val = row[pk];
			parts.push(`${pk}=${val === null ? "NULL" : val}`);
		}
		return `Row Detail — ${parts.join(", ")}`;
	}

	// ── Navigation ────────────────────────────────────────────

	function canGoPrev(): boolean {
		return currentIndex() > 0;
	}

	function canGoNext(): boolean {
		return currentIndex() < props.rows.length - 1;
	}

	function saveCurrentEdits() {
		const edits = localEdits();
		if (Object.keys(edits).length > 0) {
			props.onSave(currentIndex(), edits);
		}
	}

	function navigateTo(index: number) {
		saveCurrentEdits();
		setLocalEdits({});
		setCurrentIndex(index);
		props.onNavigate(index);
	}

	function handlePrev() {
		if (canGoPrev()) navigateTo(currentIndex() - 1);
	}

	function handleNext() {
		if (canGoNext()) navigateTo(currentIndex() + 1);
	}

	// ── Save / Cancel ─────────────────────────────────────────

	function handleSave() {
		saveCurrentEdits();
		props.onClose();
	}

	function handleCancel() {
		// Discard local edits — don't save to pendingChanges
		props.onClose();
	}

	// ── Keyboard ──────────────────────────────────────────────

	function handleDialogKeyDown(e: KeyboardEvent) {
		if (e.key === "ArrowUp" && (e.altKey || e.ctrlKey)) {
			e.preventDefault();
			handlePrev();
		} else if (e.key === "ArrowDown" && (e.altKey || e.ctrlKey)) {
			e.preventDefault();
			handleNext();
		}
	}

	// ── Render field input by type ────────────────────────────

	function renderInput(col: GridColumnDef) {
		const isPk = pkColumns().has(col.name);
		const readOnly = isPk;
		const value = getValue(col.name);
		const isNull = isFieldNull(col.name);

		if (isBooleanType(col.dataType)) {
			return (
				<div class="row-detail__checkbox-row">
					<input
						type="checkbox"
						checked={!!value && !isNull}
						disabled={readOnly}
						onChange={(e) => setFieldValue(col.name, e.target.checked)}
					/>
					<span style={{ "font-size": "var(--font-size-sm)", color: "var(--text-secondary)" }}>
						{isNull ? "NULL" : value ? "true" : "false"}
					</span>
					<Show when={col.nullable && !readOnly}>
						<button
							class="row-detail__null-btn"
							onClick={() => setNull(col.name)}
							title="Set NULL"
						>
							NULL
						</button>
					</Show>
				</div>
			);
		}

		if (isDateType(col.dataType)) {
			const inputType = col.dataType.toLowerCase() === "date" ? "date" : "datetime-local";
			return (
				<div class="row-detail__input-row">
					<input
						class="row-detail__input"
						classList={{ "row-detail__input--null": isNull }}
						type={inputType}
						value={isNull ? "" : dateInputValue(value, col.dataType)}
						readOnly={readOnly}
						placeholder={isNull ? "NULL" : ""}
						onInput={(e) => {
							const v = e.target.value;
							if (v === "") {
								if (col.nullable) setFieldValue(col.name, null);
							} else {
								setFieldValue(col.name, v);
							}
						}}
					/>
					<Show when={col.nullable && !readOnly}>
						<button
							class="row-detail__null-btn"
							onClick={() => setNull(col.name)}
							title="Set NULL"
						>
							NULL
						</button>
					</Show>
				</div>
			);
		}

		if (isTextType(col.dataType)) {
			return (
				<div class="row-detail__input-row">
					<Show when={isNull && readOnly}>
						<input
							class="row-detail__input row-detail__input--null"
							type="text"
							value="NULL"
							readOnly
						/>
					</Show>
					<Show when={!(isNull && readOnly)}>
						<textarea
							class="row-detail__textarea"
							classList={{ "row-detail__input--null": isNull }}
							value={isNull ? "" : valueToString(value)}
							readOnly={readOnly}
							placeholder={isNull ? "NULL" : ""}
							onInput={(e) => {
								setFieldValue(col.name, parseValue(e.target.value, col));
							}}
						/>
					</Show>
					<Show when={col.nullable && !readOnly}>
						<button
							class="row-detail__null-btn"
							onClick={() => setNull(col.name)}
							title="Set NULL"
						>
							NULL
						</button>
					</Show>
				</div>
			);
		}

		// Numeric and generic fallback
		return (
			<div class="row-detail__input-row">
				<input
					class="row-detail__input"
					classList={{ "row-detail__input--null": isNull }}
					type="text"
					inputMode={isNumericType(col.dataType) ? "numeric" : undefined}
					value={isNull ? "" : valueToString(value)}
					readOnly={readOnly}
					placeholder={isNull ? "NULL" : ""}
					onInput={(e) => {
						setFieldValue(col.name, parseValue(e.target.value, col));
					}}
				/>
				<Show when={col.nullable && !readOnly}>
					<button
						class="row-detail__null-btn"
						onClick={() => setNull(col.name)}
						title="Set NULL"
					>
						NULL
					</button>
				</Show>
			</div>
		);
	}

	return (
		<Dialog open={props.open} title={dialogTitle()} onClose={handleCancel}>
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
			<div class="row-detail" onKeyDown={handleDialogKeyDown}>
				{/* Navigation bar */}
				<div class="row-detail__nav">
					<span class="row-detail__nav-info">
						Row {currentIndex() + 1} of {props.rows.length}
					</span>
					<div class="row-detail__nav-buttons">
						<button
							class="row-detail__nav-btn"
							disabled={!canGoPrev()}
							onClick={handlePrev}
							title="Previous row (Ctrl+Up)"
						>
							<ChevronUp size={14} /> Prev
						</button>
						<button
							class="row-detail__nav-btn"
							disabled={!canGoNext()}
							onClick={handleNext}
							title="Next row (Ctrl+Down)"
						>
							Next <ChevronDown size={14} />
						</button>
					</div>
				</div>

				{/* Field list */}
				<div class="row-detail__fields">
					<For each={props.columns}>
						{(col) => {
							const fk = () => fkMap().get(col.name);
							return (
								<div
									class="row-detail__field"
									classList={{ "row-detail__field--changed": isChanged(col.name) }}
								>
									<div class="row-detail__label">
										<span class="row-detail__label-name">{col.name}</span>
										<span class="row-detail__label-type">{col.dataType}</span>
										<Show when={col.isPrimaryKey}>
											<span class="row-detail__label-badge row-detail__label-badge--pk">PK</span>
										</Show>
										<Show when={fk()}>
											<span class="row-detail__label-badge row-detail__label-badge--fk">FK</span>
										</Show>
									</div>
									<Show when={fk()}>
										{(fkInfo) => (
											<span class="row-detail__fk-target">
												&#x2192; {fkInfo().referencedTable}.{fkInfo().referencedColumns.join(", ")}
											</span>
										)}
									</Show>
									{renderInput(col)}
								</div>
							);
						}}
					</For>
				</div>

				{/* Actions */}
				<div class="row-detail__actions">
					<button
						class="btn btn--secondary"
						onClick={handleCancel}
					>
						Cancel
					</button>
					<button
						class="btn btn--primary"
						onClick={handleSave}
					>
						Save
					</button>
				</div>
			</div>
		</Dialog>
	);
}
