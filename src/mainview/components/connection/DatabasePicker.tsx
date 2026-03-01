import { createSignal, For, Show, createEffect } from "solid-js";
import type { ConnectionInfo } from "../../../shared/types/connection";
import type { DatabaseInfo } from "../../../shared/types/database";
import { connectionsStore } from "../../stores/connections";
import Dialog from "../common/Dialog";

interface DatabasePickerProps {
	open: boolean;
	connection: ConnectionInfo | null;
	onClose: () => void;
}

export default function DatabasePicker(props: DatabasePickerProps) {
	const [search, setSearch] = createSignal("");
	const [loading, setLoading] = createSignal<Set<string>>(new Set());

	// Refresh available databases when dialog opens
	createEffect(() => {
		if (props.open && props.connection) {
			connectionsStore.loadAvailableDatabases(props.connection.id);
		}
	});

	const databases = (): DatabaseInfo[] => {
		if (!props.connection) return [];
		return connectionsStore.getAvailableDatabases(props.connection.id);
	};

	const filtered = () => {
		const q = search().toLowerCase();
		if (!q) return databases();
		return databases().filter((db) => db.name.toLowerCase().includes(q));
	};

	async function handleToggle(db: DatabaseInfo) {
		if (!props.connection) return;
		if (db.isDefault) return; // Can't toggle default

		setLoading((prev) => {
			const next = new Set(prev);
			next.add(db.name);
			return next;
		});

		try {
			if (db.isActive) {
				await connectionsStore.deactivateDatabase(props.connection.id, db.name);
			} else {
				await connectionsStore.activateDatabase(props.connection.id, db.name);
			}
		} catch (err) {
			console.error("Failed to toggle database:", err);
		} finally {
			setLoading((prev) => {
				const next = new Set(prev);
				next.delete(db.name);
				return next;
			});
		}
	}

	return (
		<Show when={props.open && props.connection}>
			<Dialog
				open={props.open}
				title={`Databases — ${props.connection!.name}`}
				onClose={props.onClose}
			>
				<div style={{ "min-width": "320px" }}>
					<input
						type="text"
						class="form-input"
						placeholder="Search databases..."
						value={search()}
						onInput={(e) => setSearch(e.currentTarget.value)}
						style={{ "margin-bottom": "8px", width: "100%", "box-sizing": "border-box" }}
					/>

					<div style={{ "max-height": "300px", overflow: "auto" }}>
						<For each={filtered()}>
							{(db) => {
								const isLoading = () => loading().has(db.name);
								return (
									<label
										style={{
											display: "flex",
											"align-items": "center",
											gap: "8px",
											padding: "4px 0",
											cursor: db.isDefault ? "default" : "pointer",
											opacity: isLoading() ? "0.5" : "1",
										}}
									>
										<input
											type="checkbox"
											checked={db.isActive}
											disabled={db.isDefault || isLoading()}
											onChange={() => handleToggle(db)}
										/>
										<span>{db.name}</span>
										<Show when={db.isDefault}>
											<span style={{
												"font-size": "0.75em",
												color: "var(--text-muted)",
												"margin-left": "auto",
											}}>
												default
											</span>
										</Show>
									</label>
								);
							}}
						</For>
					</div>

					<Show when={filtered().length === 0}>
						<div style={{ color: "var(--text-muted)", "text-align": "center", padding: "16px 0" }}>
							No databases found
						</div>
					</Show>
				</div>
			</Dialog>
		</Show>
	);
}
