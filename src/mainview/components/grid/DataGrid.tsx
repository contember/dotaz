import { createSignal, For, onMount, Show } from "solid-js";
import type { ColumnConfig } from "../../stores/grid";
import { gridStore } from "../../stores/grid";
import { rpc } from "../../lib/rpc";
import GridHeader from "./GridHeader";
import "./DataGrid.css";

interface DataGridProps {
	tabId: string;
	connectionId: string;
	schema: string;
	table: string;
}

const DEFAULT_COLUMN_WIDTH = 150;

function getColumnWidth(col: string, config: Record<string, ColumnConfig>): number {
	return config[col]?.width ?? DEFAULT_COLUMN_WIDTH;
}

function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export default function DataGrid(props: DataGridProps) {
	const [fkColumns, setFkColumns] = createSignal<Set<string>>(new Set());

	const tab = () => gridStore.getTab(props.tabId);

	onMount(async () => {
		const existing = gridStore.getTab(props.tabId);
		if (!existing || existing.columns.length === 0) {
			gridStore.loadTableData(props.tabId, props.connectionId, props.schema, props.table);
		}

		try {
			const fks = await rpc.schema.getForeignKeys(
				props.connectionId,
				props.schema,
				props.table,
			);
			const fkCols = new Set<string>();
			for (const fk of fks) {
				for (const col of fk.columns) {
					fkCols.add(col);
				}
			}
			setFkColumns(fkCols);
		} catch {
			// FK info is non-critical
		}
	});

	function handleToggleSort(column: string, multi: boolean) {
		gridStore.toggleSort(props.tabId, column, multi);
	}

	function handleResizeColumn(column: string, width: number) {
		gridStore.setColumnWidth(props.tabId, column, width);
	}

	return (
		<div class="data-grid">
			<div class="data-grid__toolbar">
				{/* Toolbar placeholder -- FilterBar (DOTAZ-022), ColumnManager (DOTAZ-023) */}
			</div>

			<Show when={tab()}>
				{(tabState) => (
					<>
						<Show when={tabState().loading}>
							<div class="data-grid__loading">
								<div class="data-grid__spinner" />
								Loading...
							</div>
						</Show>

						<div
							class="data-grid__table-container"
							classList={{ "data-grid__table-container--loading": tabState().loading }}
						>
							<GridHeader
								columns={tabState().columns}
								sort={tabState().sort}
								columnConfig={tabState().columnConfig}
								fkColumns={fkColumns()}
								onToggleSort={handleToggleSort}
								onResizeColumn={handleResizeColumn}
							/>

							<div class="data-grid__body">
								<For each={tabState().rows}>
									{(row) => (
										<div class="data-grid__row">
											<For each={tabState().columns}>
												{(col) => (
													<div
														class="data-grid__cell"
														classList={{
															"data-grid__cell--null":
																row[col.name] === null || row[col.name] === undefined,
														}}
														style={{
															width: `${getColumnWidth(col.name, tabState().columnConfig)}px`,
														}}
													>
														{formatCellValue(row[col.name])}
													</div>
												)}
											</For>
										</div>
									)}
								</For>

								<Show when={!tabState().loading && tabState().rows.length === 0}>
									<div class="data-grid__empty">No data</div>
								</Show>
							</div>
						</div>

						<div class="data-grid__footer">
							{/* Pagination placeholder -- DOTAZ-021 */}
							<Show when={tabState().totalCount > 0}>
								<span class="data-grid__footer-info">
									{tabState().rows.length} of {tabState().totalCount} rows
								</span>
							</Show>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
