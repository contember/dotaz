import { createEffect, createSignal, For, Show } from "solid-js";
import type {
	ExportFormat,
	CsvDelimiter,
	CsvEncoding,
	ExportPreviewRequest,
} from "../../../shared/types/export";
import type { ColumnFilter, SortColumn } from "../../../shared/types/grid";
import { gridStore } from "../../stores/grid";
import { rpc } from "../../lib/rpc";
import Download from "lucide-solid/icons/download";
import Eye from "lucide-solid/icons/eye";
import Dialog from "../common/Dialog";
import "./ExportDialog.css";

type ExportScope = "all" | "view" | "selected";

interface ExportDialogProps {
	open: boolean;
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
	onClose: () => void;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
	csv: "CSV",
	json: "JSON",
	sql: "SQL INSERT",
};

const ENCODING_LABELS: Record<CsvEncoding, string> = {
	"utf-8": "UTF-8",
	"iso-8859-1": "ISO-8859-1 (Latin-1)",
	"windows-1252": "Windows-1252",
};

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
	",": "Comma (,)",
	";": "Semicolon (;)",
	"\t": "Tab",
};

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
	csv: "csv",
	json: "json",
	sql: "sql",
};

export default function ExportDialog(props: ExportDialogProps) {
	const [format, setFormat] = createSignal<ExportFormat>("csv");
	const [scope, setScope] = createSignal<ExportScope>("all");
	const [delimiter, setDelimiter] = createSignal<CsvDelimiter>(",");
	const [encoding, setEncoding] = createSignal<CsvEncoding>("utf-8");
	const [utf8Bom, setUtf8Bom] = createSignal(false);
	const [includeHeaders, setIncludeHeaders] = createSignal(true);
	const [batchSize, setBatchSize] = createSignal(100);
	const [preview, setPreview] = createSignal("");
	const [previewLoading, setPreviewLoading] = createSignal(false);
	const [exporting, setExporting] = createSignal(false);
	const [exportResult, setExportResult] = createSignal<{
		rowCount: number;
		filePath: string;
		sizeBytes: number;
	} | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	const tab = () => gridStore.getTab(props.tabId);

	const hasSelection = () => {
		const t = tab();
		return t ? t.selectedRows.size > 0 : false;
	};

	const hasPrimaryKey = () => {
		const t = tab();
		if (!t) return false;
		return t.columns.some((c) => c.isPrimaryKey);
	};

	const selectedRowCount = () => {
		const t = tab();
		return t ? t.selectedRows.size : 0;
	};

	const rowCountForScope = () => {
		const t = tab();
		if (!t) return 0;
		if (scope() === "selected") return selectedRowCount();
		if (scope() === "view" && t.filters.length > 0) return t.totalCount;
		return t.totalCount;
	};

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			setFormat("csv");
			setScope("all");
			setDelimiter(",");
			setEncoding("utf-8");
			setUtf8Bom(false);
			setIncludeHeaders(true);
			setBatchSize(100);
			setPreview("");
			setPreviewLoading(false);
			setExporting(false);
			setExportResult(null);
			setError(null);
		}
	});

	function getExportFilters(): ColumnFilter[] | undefined {
		const t = tab();
		if (!t) return undefined;

		if (scope() === "all") return undefined;
		if (scope() === "view") {
			return t.filters.length > 0 ? t.filters : undefined;
		}

		// Selected rows: construct IN filter from PK values
		if (scope() === "selected") {
			const pkCols = t.columns.filter((c) => c.isPrimaryKey);
			if (pkCols.length === 0) return undefined;

			const selectedIndices = [...t.selectedRows].sort((a, b) => a - b);
			const filters: ColumnFilter[] = [];

			for (const pkCol of pkCols) {
				const values = selectedIndices.map((i) => t.rows[i]?.[pkCol.name]);
				filters.push({
					column: pkCol.name,
					operator: "in",
					value: values,
				});
			}

			return filters;
		}

		return undefined;
	}

	function getExportSort(): SortColumn[] | undefined {
		const t = tab();
		if (!t) return undefined;
		if (scope() === "all") return undefined;
		if (scope() === "view") {
			return t.sort.length > 0 ? t.sort : undefined;
		}
		return undefined;
	}

	async function loadPreview() {
		setPreviewLoading(true);
		setPreview("");
		setError(null);

		try {
			const params: ExportPreviewRequest = {
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: format(),
				limit: 10,
				delimiter: format() === "csv" ? delimiter() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			};

			const result = await rpc.export.preview(params);
			setPreview(result.content);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPreviewLoading(false);
		}
	}

	async function handleExport() {
		setError(null);
		setExportResult(null);

		const ext = FILE_EXTENSIONS[format()];
		const defaultName = `${props.table}.${ext}`;

		try {
			const saveResult = await rpc.system.showSaveDialog({
				title: "Export Data",
				defaultName,
				filters: [{ name: FORMAT_LABELS[format()], extensions: [ext] }],
			});

			if (saveResult.cancelled || !saveResult.path) return;

			setExporting(true);

			const result = await rpc.export.exportData({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				format: format(),
				filePath: saveResult.path,
				delimiter: format() === "csv" ? delimiter() : undefined,
				encoding: format() === "csv" ? encoding() : undefined,
				utf8Bom: format() === "csv" && encoding() === "utf-8" ? utf8Bom() : undefined,
				includeHeaders: format() === "csv" ? includeHeaders() : undefined,
				batchSize: format() === "sql" ? batchSize() : undefined,
				filters: getExportFilters(),
				sort: getExportSort(),
				database: props.database,
			});

			setExportResult(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	return (
		<Dialog
			open={props.open}
			title="Export Data"
			onClose={props.onClose}
		>
			<div class="export-dialog">
				{/* Format selection */}
				<div class="export-dialog__section">
					<label class="export-dialog__label">Format</label>
					<div class="export-dialog__format-group">
						<For each={Object.entries(FORMAT_LABELS) as [ExportFormat, string][]}>
							{([fmt, label]) => (
								<button
									class="export-dialog__format-btn"
									classList={{ "export-dialog__format-btn--active": format() === fmt }}
									onClick={() => setFormat(fmt)}
								>
									{label}
								</button>
							)}
						</For>
					</div>
				</div>

				{/* Scope selection */}
				<div class="export-dialog__section">
					<label class="export-dialog__label">Scope</label>
					<div class="export-dialog__scope-group">
						<label class="export-dialog__radio-label">
							<input
								type="radio"
								name="scope"
								value="all"
								checked={scope() === "all"}
								onChange={() => setScope("all")}
							/>
							Entire table
						</label>
						<label class="export-dialog__radio-label">
							<input
								type="radio"
								name="scope"
								value="view"
								checked={scope() === "view"}
								onChange={() => setScope("view")}
							/>
							Current view (with filters)
						</label>
						<label
							class="export-dialog__radio-label"
							classList={{ "export-dialog__radio-label--disabled": !hasSelection() || !hasPrimaryKey() }}
						>
							<input
								type="radio"
								name="scope"
								value="selected"
								checked={scope() === "selected"}
								disabled={!hasSelection() || !hasPrimaryKey()}
								onChange={() => setScope("selected")}
							/>
							Selected rows ({selectedRowCount()})
						</label>
					</div>
				</div>

				{/* Format-specific options */}
				<Show when={format() === "csv"}>
					<div class="export-dialog__section">
						<label class="export-dialog__label">Options</label>
						<div class="export-dialog__options">
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Delimiter</label>
								<select
									class="export-dialog__select"
									value={delimiter()}
									onChange={(e) => setDelimiter(e.currentTarget.value as CsvDelimiter)}
								>
									<For each={Object.entries(DELIMITER_LABELS)}>
										{([value, label]) => (
											<option value={value}>{label}</option>
										)}
									</For>
								</select>
							</div>
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Encoding</label>
								<select
									class="export-dialog__select"
									value={encoding()}
									onChange={(e) => setEncoding(e.currentTarget.value as CsvEncoding)}
								>
									<For each={Object.entries(ENCODING_LABELS)}>
										{([value, label]) => (
											<option value={value}>{label}</option>
										)}
									</For>
								</select>
							</div>
							<label class="export-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={includeHeaders()}
									onChange={(e) => setIncludeHeaders(e.currentTarget.checked)}
								/>
								Include column headers
							</label>
							<Show when={encoding() === "utf-8"}>
								<label class="export-dialog__checkbox-label">
									<input
										type="checkbox"
										checked={utf8Bom()}
										onChange={(e) => setUtf8Bom(e.currentTarget.checked)}
									/>
									Include BOM (byte order mark)
								</label>
							</Show>
						</div>
					</div>
				</Show>

				<Show when={format() === "sql"}>
					<div class="export-dialog__section">
						<label class="export-dialog__label">Options</label>
						<div class="export-dialog__options">
							<div class="export-dialog__field">
								<label class="export-dialog__field-label">Rows per INSERT</label>
								<input
									class="export-dialog__input export-dialog__input--small"
									type="number"
									min={1}
									max={10000}
									value={batchSize()}
									onInput={(e) => {
										const v = parseInt(e.currentTarget.value, 10);
										if (!isNaN(v) && v > 0) setBatchSize(v);
									}}
								/>
							</div>
						</div>
					</div>
				</Show>

				{/* Preview */}
				<div class="export-dialog__section">
					<div class="export-dialog__preview-header">
						<label class="export-dialog__label">Preview</label>
						<button
							class="export-dialog__preview-btn"
							onClick={loadPreview}
							disabled={previewLoading()}
						>
							<Eye size={12} /> {previewLoading() ? "Loading..." : "Load Preview"}
						</button>
					</div>
					<Show when={preview()}>
						<pre class="export-dialog__preview">{preview()}</pre>
					</Show>
					<Show when={previewLoading()}>
						<div class="export-dialog__preview export-dialog__preview--loading">
							Loading preview...
						</div>
					</Show>
				</div>

				{/* Export progress */}
				<Show when={exporting()}>
					<div class="export-dialog__progress">
						<div class="export-dialog__progress-bar">
							<div class="export-dialog__progress-bar-fill" />
						</div>
						<span class="export-dialog__progress-text">Exporting...</span>
					</div>
				</Show>

				{/* Export result */}
				<Show when={exportResult()}>
					{(result) => (
						<div class="export-dialog__result">
							Exported {result().rowCount} row{result().rowCount !== 1 ? "s" : ""} ({formatFileSize(result().sizeBytes)})
						</div>
					)}
				</Show>

				{/* Error */}
				<Show when={error()}>
					<div class="export-dialog__error">{error()}</div>
				</Show>

				{/* Info about row count */}
				<div class="export-dialog__info">
					{scope() === "selected"
						? `${selectedRowCount()} row${selectedRowCount() !== 1 ? "s" : ""} selected`
						: `${rowCountForScope()} row${rowCountForScope() !== 1 ? "s" : ""} to export`}
				</div>

				{/* Actions */}
				<div class="export-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onClose}
					>
						Close
					</button>
					<button
						class="btn btn--primary"
						onClick={handleExport}
						disabled={exporting()}
					>
						<Download size={14} /> {exporting() ? "Exporting..." : "Export"}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
