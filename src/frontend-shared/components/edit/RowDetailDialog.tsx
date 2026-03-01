import { createSignal, createEffect, createMemo, For, Show, on } from "solid-js";
import type { GridColumnDef, ColumnFilter } from "../../../shared/types/grid";
import { DatabaseDataType } from "../../../shared/types/database";
import type { ForeignKeyInfo, ReferencingForeignKeyInfo } from "../../../shared/types/database";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { buildCountQuery } from "../../../shared/sql";
import { rpc } from "../../lib/rpc";
import { connectionsStore } from "../../stores/connections";
import { isNumericType, isBooleanType, isDateType, isTextType } from "../../lib/column-types";
import Dialog from "../common/Dialog";
import "./RowDetailDialog.css";

interface RowDetailDialogProps {
	open: boolean;
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
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
	/** Navigate to a referencing table with filters applied. */
	onNavigateToTable?: (schema: string, table: string, filters: ColumnFilter[]) => void;
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

function dateInputValue(value: unknown, dataType: DatabaseDataType): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	if (dataType === DatabaseDataType.Date) {
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

	// ── Reverse FK (Referenced By) ───────────────────────────
	const referencingFks = createMemo(() =>
		connectionsStore.getReferencingForeignKeys(
			props.connectionId, props.schema, props.table, props.database,
		),
	);
	const [referencingCounts, setReferencingCounts] = createSignal<Record<string, number>>({});

	// Fetch counts for each referencing FK when row changes
	createEffect(on([referencingFks, currentIndex], () => {
		const fks = referencingFks();
		const row = currentRow();
		if (!fks.length || !row) {
			setReferencingCounts({});
			return;
		}

		const dialect = connectionsStore.getDialect(props.connectionId);
		const counts: Record<string, number> = {};
		const promises = fks.map(async (fk) => {
			const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
				column: fk.referencingColumns[i],
				operator: "eq" as const,
				value: row[refCol],
			}));

			if (filters.some((f) => f.value === null || f.value === undefined)) {
				counts[fk.constraintName] = 0;
				return;
			}

			try {
				const countQuery = buildCountQuery(fk.referencingSchema, fk.referencingTable, filters, dialect);
				const results = await rpc.query.execute({
					connectionId: props.connectionId, sql: countQuery.sql, queryId: `ref-count-${fk.constraintName}`,
					params: countQuery.params, database: props.database,
				});
				counts[fk.constraintName] = Number(results[0]?.rows[0]?.count ?? 0);
			} catch {
				counts[fk.constraintName] = -1;
			}
		});

		Promise.all(promises).then(() => setReferencingCounts({ ...counts }));
	}));

	function handleReferencingClick(fk: ReferencingForeignKeyInfo) {
		if (!props.onNavigateToTable) return;
		const row = currentRow();
		if (!row) return;

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: "eq" as const,
			value: String(row[refCol]),
		}));

		saveCurrentEdits();
		props.onNavigateToTable(fk.referencingSchema, fk.referencingTable, filters);
		props.onClose();
	}

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
					<span style={{ "font-size": "var(--font-size-sm)", color: "var(--ink-secondary)" }}>
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
			const inputType = col.dataType === DatabaseDataType.Date ? "date" : "datetime-local";
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

				{/* Referenced By */}
				<Show when={referencingFks().length > 0}>
					<div class="row-detail__referenced-by">
						<div class="row-detail__referenced-by-header">Referenced By</div>
						<div class="row-detail__referenced-by-list">
							<For each={referencingFks()}>
								{(fk) => {
									const count = () => referencingCounts()[fk.constraintName];
									return (
										<button
											class="row-detail__referenced-by-item"
											onClick={() => handleReferencingClick(fk)}
											disabled={!props.onNavigateToTable}
											title={`Show referencing rows in ${fk.referencingTable}`}
										>
											<span class="row-detail__referenced-by-table">
												{fk.referencingSchema !== props.schema
													? `${fk.referencingSchema}.${fk.referencingTable}`
													: fk.referencingTable}
											</span>
											<span class="row-detail__referenced-by-cols">
												({fk.referencingColumns.join(", ")})
											</span>
											<Show when={count() !== undefined}>
												<span class="row-detail__referenced-by-count">
													{count() === -1 ? "?" : count()}
												</span>
											</Show>
										</button>
									);
								}}
							</For>
						</div>
					</div>
				</Show>

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
