import { createEffect, createSignal, For, Show } from "solid-js";
import type {
	ImportFormat,
	CsvDelimiter,
	ColumnMapping,
	ImportPreviewResult,
} from "../../../shared/types/import";
import type { ColumnInfo } from "../../../shared/types/database";
import { rpc } from "../../lib/rpc";
import Upload from "lucide-solid/icons/upload";
import Eye from "lucide-solid/icons/eye";
import Dialog from "../common/Dialog";
import "./ImportDialog.css";

interface ImportDialogProps {
	open: boolean;
	connectionId: string;
	schema: string;
	table: string;
	database?: string;
	onClose: () => void;
	onImported?: () => void;
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
	csv: "CSV",
	json: "JSON",
};

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
	",": "Comma (,)",
	";": "Semicolon (;)",
	"\t": "Tab",
};

const FILE_ACCEPT: Record<ImportFormat, string> = {
	csv: ".csv,.tsv,.txt",
	json: ".json",
};

export default function ImportDialog(props: ImportDialogProps) {
	let fileInputRef: HTMLInputElement | undefined;

	const [format, setFormat] = createSignal<ImportFormat>("csv");
	const [delimiter, setDelimiter] = createSignal<CsvDelimiter>(",");
	const [hasHeader, setHasHeader] = createSignal(true);
	const [fileContent, setFileContent] = createSignal<string | null>(null);
	const [fileName, setFileName] = createSignal<string | null>(null);
	const [preview, setPreview] = createSignal<ImportPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = createSignal(false);
	const [mappings, setMappings] = createSignal<ColumnMapping[]>([]);
	const [tableColumns, setTableColumns] = createSignal<ColumnInfo[]>([]);
	const [importing, setImporting] = createSignal(false);
	const [importResult, setImportResult] = createSignal<{ rowCount: number } | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	// Reset form when dialog opens
	createEffect(() => {
		if (props.open) {
			setFormat("csv");
			setDelimiter(",");
			setHasHeader(true);
			setFileContent(null);
			setFileName(null);
			setPreview(null);
			setPreviewLoading(false);
			setMappings([]);
			setTableColumns([]);
			setImporting(false);
			setImportResult(null);
			setError(null);
			if (fileInputRef) fileInputRef.value = "";
			loadTableColumns();
		}
	});

	async function loadTableColumns() {
		try {
			const schema = await rpc.schema.load({
				connectionId: props.connectionId,
				database: props.database,
			});
			const columns = schema.columns[`${props.schema}.${props.table}`] ?? [];
			setTableColumns(columns);
		} catch {
			// Ignore schema load errors
		}
	}

	function handleBrowseClick() {
		if (fileInputRef) {
			fileInputRef.accept = FILE_ACCEPT[format()];
			fileInputRef.click();
		}
	}

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		setFileName(file.name);
		setError(null);

		try {
			const content = await file.text();
			setFileContent(content);
			await loadPreview(content);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function loadPreview(content?: string) {
		const fc = content ?? fileContent();
		if (!fc) return;

		setPreviewLoading(true);
		setPreview(null);
		setError(null);

		try {
			const result = await rpc.import.preview({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				database: props.database,
				fileContent: fc,
				format: format(),
				delimiter: format() === "csv" ? delimiter() : undefined,
				hasHeader: format() === "csv" ? hasHeader() : undefined,
				limit: 20,
			});

			setPreview(result);
			autoMapColumns(result.fileColumns);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPreviewLoading(false);
		}
	}

	function autoMapColumns(fileColumns: string[]) {
		const tCols = tableColumns();
		const tColNames = new Set(tCols.map((c) => c.name));
		const tColNamesLower = new Map(tCols.map((c) => [c.name.toLowerCase(), c.name]));

		const newMappings: ColumnMapping[] = fileColumns.map((fc) => {
			if (tColNames.has(fc)) {
				return { fileColumn: fc, tableColumn: fc };
			}
			const match = tColNamesLower.get(fc.toLowerCase());
			if (match) {
				return { fileColumn: fc, tableColumn: match };
			}
			return { fileColumn: fc, tableColumn: null };
		});

		setMappings(newMappings);
	}

	function updateMapping(index: number, tableColumn: string | null) {
		setMappings((prev) => {
			const next = [...prev];
			next[index] = { ...next[index], tableColumn };
			return next;
		});
	}

	function activeMappingCount() {
		return mappings().filter((m) => m.tableColumn !== null).length;
	}

	async function handleImport() {
		const fc = fileContent();
		if (!fc) return;

		setError(null);
		setImportResult(null);
		setImporting(true);

		try {
			const result = await rpc.import.importData({
				connectionId: props.connectionId,
				schema: props.schema,
				table: props.table,
				database: props.database,
				fileContent: fc,
				format: format(),
				delimiter: format() === "csv" ? delimiter() : undefined,
				hasHeader: format() === "csv" ? hasHeader() : undefined,
				mappings: mappings(),
			});

			setImportResult(result);
			props.onImported?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setImporting(false);
		}
	}

	function formatValue(value: unknown): string {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "object") return JSON.stringify(value);
		return String(value);
	}

	const canImport = () =>
		fileContent() !== null &&
		activeMappingCount() > 0 &&
		!importing() &&
		!importResult();

	return (
		<Dialog
			open={props.open}
			title="Import Data"
			onClose={props.onClose}
		>
			<div class="import-dialog">
				{/* Hidden file input */}
				<input
					ref={fileInputRef}
					type="file"
					style={{ display: "none" }}
					accept={FILE_ACCEPT[format()]}
					onChange={handleFileChange}
				/>

				{/* Format selection */}
				<div class="import-dialog__section">
					<label class="import-dialog__label">Format</label>
					<div class="import-dialog__format-group">
						<For each={Object.entries(FORMAT_LABELS) as [ImportFormat, string][]}>
							{([fmt, label]) => (
								<button
									class="import-dialog__format-btn"
									classList={{ "import-dialog__format-btn--active": format() === fmt }}
									onClick={() => {
										setFormat(fmt);
										setFileContent(null);
										setFileName(null);
										setPreview(null);
										setMappings([]);
										setImportResult(null);
										setError(null);
										if (fileInputRef) fileInputRef.value = "";
									}}
								>
									{label}
								</button>
							)}
						</For>
					</div>
				</div>

				{/* File selection */}
				<div class="import-dialog__section">
					<label class="import-dialog__label">File</label>
					<div class="import-dialog__file-row">
						<div
							class="import-dialog__file-name"
							classList={{ "import-dialog__file-name--empty": !fileName() }}
						>
							{fileName() ?? "No file selected"}
						</div>
						<button
							class="import-dialog__browse-btn"
							onClick={handleBrowseClick}
							disabled={importing()}
						>
							Browse...
						</button>
					</div>
				</div>

				{/* CSV options */}
				<Show when={format() === "csv"}>
					<div class="import-dialog__section">
						<label class="import-dialog__label">Options</label>
						<div class="import-dialog__options">
							<div class="import-dialog__field">
								<label class="import-dialog__field-label">Delimiter</label>
								<select
									class="import-dialog__select"
									value={delimiter()}
									onChange={(e) => {
										setDelimiter(e.currentTarget.value as CsvDelimiter);
										if (fileContent()) loadPreview();
									}}
								>
									<For each={Object.entries(DELIMITER_LABELS)}>
										{([value, label]) => (
											<option value={value}>{label}</option>
										)}
									</For>
								</select>
							</div>
							<label class="import-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={hasHeader()}
									onChange={(e) => {
										setHasHeader(e.currentTarget.checked);
										if (fileContent()) loadPreview();
									}}
								/>
								First row is header
							</label>
						</div>
					</div>
				</Show>

				{/* Column mapping */}
				<Show when={preview() && mappings().length > 0}>
					<div class="import-dialog__section">
						<label class="import-dialog__label">
							Column Mapping ({activeMappingCount()} of {mappings().length} mapped)
						</label>
						<div class="import-dialog__mapping">
							<div class="import-dialog__mapping-header">
								<span>File Column</span>
								<span />
								<span>Table Column</span>
							</div>
							<For each={mappings()}>
								{(mapping, index) => (
									<div class="import-dialog__mapping-row">
										<div class="import-dialog__mapping-file-col">
											{mapping.fileColumn}
										</div>
										<div class="import-dialog__mapping-arrow">&rarr;</div>
										<select
											class="import-dialog__mapping-select"
											value={mapping.tableColumn ?? ""}
											onChange={(e) => {
												const val = e.currentTarget.value;
												updateMapping(index(), val === "" ? null : val);
											}}
										>
											<option value="">(skip)</option>
											<For each={tableColumns()}>
												{(col) => (
													<option value={col.name}>{col.name}</option>
												)}
											</For>
										</select>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Data preview */}
				<Show when={preview()}>
					{(p) => (
						<div class="import-dialog__section">
							<div class="import-dialog__preview-header">
								<label class="import-dialog__label">
									Preview (first {Math.min(p().rows.length, 20)} of {p().totalRows} rows)
								</label>
								<button
									class="import-dialog__browse-btn"
									onClick={() => loadPreview()}
									disabled={previewLoading() || !fileContent()}
								>
									<Eye size={12} /> Reload
								</button>
							</div>
							<div class="import-dialog__preview">
								<table>
									<thead>
										<tr>
											<For each={p().fileColumns}>
												{(col) => <th>{col}</th>}
											</For>
										</tr>
									</thead>
									<tbody>
										<For each={p().rows.slice(0, 10)}>
											{(row) => (
												<tr>
													<For each={p().fileColumns}>
														{(col) => (
															<td>
																<Show
																	when={row[col] !== null && row[col] !== undefined}
																	fallback={<span class="import-dialog__preview-null">NULL</span>}
																>
																	{formatValue(row[col])}
																</Show>
															</td>
														)}
													</For>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
					)}
				</Show>

				<Show when={previewLoading()}>
					<div class="import-dialog__preview--loading">
						Loading preview...
					</div>
				</Show>

				{/* Import progress */}
				<Show when={importing()}>
					<div class="import-dialog__progress">
						<div class="import-dialog__progress-bar">
							<div class="import-dialog__progress-bar-fill" />
						</div>
						<span class="import-dialog__progress-text">Importing...</span>
					</div>
				</Show>

				{/* Import result */}
				<Show when={importResult()}>
					{(result) => (
						<div class="import-dialog__result">
							Successfully imported {result().rowCount} row{result().rowCount !== 1 ? "s" : ""}
						</div>
					)}
				</Show>

				{/* Error */}
				<Show when={error()}>
					<div class="import-dialog__error">{error()}</div>
				</Show>

				{/* Info */}
				<Show when={preview() && !importResult()}>
					<div class="import-dialog__info">
						{preview()!.totalRows} row{preview()!.totalRows !== 1 ? "s" : ""} to import
						{activeMappingCount() > 0
							? ` into ${activeMappingCount()} column${activeMappingCount() !== 1 ? "s" : ""}`
							: " (no columns mapped)"}
					</div>
				</Show>

				{/* Actions */}
				<div class="import-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onClose}
					>
						{importResult() ? "Close" : "Cancel"}
					</button>
					<Show when={!importResult()}>
						<button
							class="btn btn--primary"
							onClick={handleImport}
							disabled={!canImport()}
						>
							<Upload size={14} /> {importing() ? "Importing..." : "Import"}
						</button>
					</Show>
				</div>
			</div>
		</Dialog>
	);
}
