import { createSignal, Show } from "solid-js";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionType,
} from "../../../shared/types/connection";
import { connectionsStore } from "../../stores/connections";
import { isStateless } from "../../lib/mode";
import { rpc } from "../../lib/rpc";
import { siPostgresql, siSqlite } from "simple-icons";
import { FolderOpen, Plug } from "lucide-solid";
import Dialog from "../common/Dialog";
import "./ConnectionDialog.css";

interface ConnectionDialogProps {
	open: boolean;
	/** Pass a ConnectionInfo to edit, or null for new connection */
	connection: ConnectionInfo | null;
	onClose: () => void;
}

function defaultPgFields() {
	return {
		name: "",
		host: "localhost",
		port: "5432",
		database: "",
		user: "",
		password: "",
		ssl: false,
	};
}

function defaultSqliteFields() {
	return {
		name: "",
		path: "",
	};
}

function parseConnectionString(input: string): ReturnType<typeof defaultPgFields> | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith("postgresql://") && !trimmed.startsWith("postgres://")) {
		return null;
	}
	try {
		const url = new URL(trimmed);
		const user = decodeURIComponent(url.username);
		const password = decodeURIComponent(url.password);
		const host = url.hostname;
		const port = url.port || "5432";
		const database = url.pathname.replace(/^\//, "");
		const sslmode = url.searchParams.get("sslmode");
		const ssl = sslmode === "require" || sslmode === "verify-full" || sslmode === "verify-ca";
		const name = user && host && database ? `${user}@${host}/${database}` : "";
		return { name, host, port, database, user, password, ssl };
	} catch {
		return null;
	}
}

export default function ConnectionDialog(props: ConnectionDialogProps) {
	const [dbType, setDbType] = createSignal<ConnectionType>("postgresql");
	const [pgFields, setPgFields] = createSignal(defaultPgFields());
	const [sqliteFields, setSqliteFields] = createSignal(defaultSqliteFields());
	const [connectionUrl, setConnectionUrl] = createSignal("");

	const [rememberPassword, setRememberPassword] = createSignal(true);
	const [testResult, setTestResult] = createSignal<{
		success: boolean;
		error?: string;
	} | null>(null);
	const [testing, setTesting] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [errors, setErrors] = createSignal<Record<string, string>>({});

	// Reset form when dialog opens or connection changes
	function resetForm() {
		setTestResult(null);
		setErrors({});
		setTesting(false);
		setSaving(false);
		setConnectionUrl("");

		const conn = props.connection;
		if (conn) {
			setDbType(conn.config.type);
			setRememberPassword(connectionsStore.getRememberPassword(conn.id));
			if (conn.config.type === "postgresql") {
				setPgFields({
					name: conn.name,
					host: conn.config.host,
					port: String(conn.config.port),
					database: conn.config.database,
					user: conn.config.user,
					password: conn.config.password,
					ssl: conn.config.ssl ?? false,
				});
			} else {
				setSqliteFields({
					name: conn.name,
					path: conn.config.path,
				});
			}
		} else {
			setDbType("postgresql");
			setRememberPassword(true);
			setPgFields(defaultPgFields());
			setSqliteFields(defaultSqliteFields());
		}
	}

	// Build config from current form state
	function buildConfig(): ConnectionConfig {
		if (dbType() === "postgresql") {
			const f = pgFields();
			return {
				type: "postgresql",
				host: f.host,
				port: Number(f.port) || 5432,
				database: f.database,
				user: f.user,
				password: f.password,
				ssl: f.ssl,
			};
		} else {
			return {
				type: "sqlite",
				path: sqliteFields().path,
			};
		}
	}

	function getName(): string {
		return dbType() === "postgresql"
			? pgFields().name
			: sqliteFields().name;
	}

	function validate(): boolean {
		const errs: Record<string, string> = {};

		if (!getName().trim()) {
			errs.name = "Name is required";
		}

		if (dbType() === "postgresql") {
			const f = pgFields();
			if (!f.host.trim()) errs.host = "Host is required";
			if (!f.port.trim() || isNaN(Number(f.port))) errs.port = "Valid port is required";
			if (!f.database.trim()) errs.database = "Database is required";
			if (!f.user.trim()) errs.user = "Username is required";
		} else {
			const f = sqliteFields();
			if (!f.path.trim()) errs.path = "File path is required";
		}

		setErrors(errs);
		return Object.keys(errs).length === 0;
	}

	async function handleTestConnection() {
		if (!validate()) return;

		setTesting(true);
		setTestResult(null);
		try {
			const result = await rpc.connections.test(buildConfig());
			setTestResult(result);
		} catch (err) {
			setTestResult({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setTesting(false);
		}
	}

	async function handleSave() {
		if (!validate()) return;

		setSaving(true);
		try {
			const name = getName().trim();
			const config = buildConfig();

			if (props.connection) {
				await connectionsStore.updateConnection(props.connection.id, name, config, rememberPassword());
			} else {
				await connectionsStore.createConnection(name, config, rememberPassword());
			}
			props.onClose();
		} catch (err) {
			setTestResult({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setSaving(false);
		}
	}

	async function handleBrowse() {
		const result = await rpc.system.showOpenDialog({
			title: "Select SQLite Database",
			filters: [
				{ name: "SQLite Databases", extensions: ["db", "sqlite", "sqlite3"] },
				{ name: "All Files", extensions: ["*"] },
			],
		});

		if (!result.cancelled && result.paths.length > 0) {
			setSqliteFields((f) => ({ ...f, path: result.paths[0] }));
		}
	}

	function updatePgField(field: string, value: string | boolean) {
		setPgFields((f) => ({ ...f, [field]: value }));
		setErrors((e) => {
			const next = { ...e };
			delete next[field];
			return next;
		});
	}

	function updateSqliteField(field: string, value: string) {
		setSqliteFields((f) => ({ ...f, [field]: value }));
		setErrors((e) => {
			const next = { ...e };
			delete next[field];
			return next;
		});
	}

	function updateName(value: string) {
		if (dbType() === "postgresql") {
			updatePgField("name", value);
		} else {
			updateSqliteField("name", value);
		}
	}

	function handleUrlInput(value: string) {
		setConnectionUrl(value);
		const parsed = parseConnectionString(value);
		if (parsed) {
			const current = pgFields();
			setPgFields({
				...parsed,
				name: current.name || parsed.name,
			});
		}
	}

	// Use a ref callback to reset form when dialog opens
	// Solid.js doesn't re-mount Show children on prop changes, so we use a getter
	const dialogOpen = () => {
		const isOpen = props.open;
		if (isOpen) {
			// Schedule reset after current batch
			queueMicrotask(resetForm);
		}
		return isOpen;
	};

	const title = () => props.connection ? "Edit Connection" : "New Connection";

	return (
		<Dialog open={dialogOpen()} title={title()} onClose={props.onClose}>
			<div class="conn-dialog">
				{/* DB Type Switcher */}
				<div class="conn-dialog__type-switcher">
					<button
						class="conn-dialog__type-btn"
						classList={{ "conn-dialog__type-btn--active": dbType() === "postgresql" }}
						onClick={() => setDbType("postgresql")}
						disabled={!!props.connection}
					>
						<svg width={14} height={14} viewBox="0 0 24 24" fill={`#${siPostgresql.hex}`} aria-hidden="true"><path d={siPostgresql.path} /></svg> PostgreSQL
					</button>
					<button
						class="conn-dialog__type-btn"
						classList={{ "conn-dialog__type-btn--active": dbType() === "sqlite" }}
						onClick={() => setDbType("sqlite")}
						disabled={!!props.connection}
					>
						<svg width={14} height={14} viewBox="0 0 24 24" fill={`#${siSqlite.hex}`} aria-hidden="true"><path d={siSqlite.path} /></svg> SQLite
					</button>
				</div>

				{/* Connection URL (PostgreSQL, new connections only) */}
				<Show when={dbType() === "postgresql" && !props.connection}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">URL</label>
						<input
							class="conn-dialog__input conn-dialog__url-input"
							type="text"
							value={connectionUrl()}
							onInput={(e) => handleUrlInput(e.currentTarget.value)}
							placeholder="postgresql://user:password@localhost:5432/mydb"
						/>
					</div>
				</Show>

				{/* Name field (shared) */}
				<div class="conn-dialog__field">
					<label class="conn-dialog__label">Name</label>
					<input
						class="conn-dialog__input"
						classList={{ "conn-dialog__input--error": !!errors().name }}
						type="text"
						value={getName()}
						onInput={(e) => updateName(e.currentTarget.value)}
						placeholder="My Connection"
					/>
					<Show when={errors().name}>
						<span class="conn-dialog__error">{errors().name}</span>
					</Show>
				</div>

				{/* PostgreSQL fields */}
				<Show when={dbType() === "postgresql"}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">Host</label>
						<input
							class="conn-dialog__input"
							classList={{ "conn-dialog__input--error": !!errors().host }}
							type="text"
							value={pgFields().host}
							onInput={(e) => updatePgField("host", e.currentTarget.value)}
							placeholder="localhost"
						/>
						<Show when={errors().host}>
							<span class="conn-dialog__error">{errors().host}</span>
						</Show>
					</div>

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">Port</label>
						<input
							class="conn-dialog__input"
							classList={{ "conn-dialog__input--error": !!errors().port }}
							type="text"
							value={pgFields().port}
							onInput={(e) => updatePgField("port", e.currentTarget.value)}
							placeholder="5432"
						/>
						<Show when={errors().port}>
							<span class="conn-dialog__error">{errors().port}</span>
						</Show>
					</div>

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">Database</label>
						<input
							class="conn-dialog__input"
							classList={{ "conn-dialog__input--error": !!errors().database }}
							type="text"
							value={pgFields().database}
							onInput={(e) => updatePgField("database", e.currentTarget.value)}
							placeholder="mydb"
						/>
						<Show when={errors().database}>
							<span class="conn-dialog__error">{errors().database}</span>
						</Show>
					</div>

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">Username</label>
						<input
							class="conn-dialog__input"
							classList={{ "conn-dialog__input--error": !!errors().user }}
							type="text"
							value={pgFields().user}
							onInput={(e) => updatePgField("user", e.currentTarget.value)}
							placeholder="postgres"
						/>
						<Show when={errors().user}>
							<span class="conn-dialog__error">{errors().user}</span>
						</Show>
					</div>

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">Password</label>
						<input
							class="conn-dialog__input"
							type="password"
							value={pgFields().password}
							onInput={(e) => updatePgField("password", e.currentTarget.value)}
						/>
					</div>

					<div class="conn-dialog__field conn-dialog__field--inline">
						<label class="conn-dialog__label conn-dialog__label--checkbox">
							<input
								type="checkbox"
								checked={pgFields().ssl}
								onChange={(e) => updatePgField("ssl", e.currentTarget.checked)}
							/>
							Use SSL
						</label>
					</div>

					<Show when={isStateless()}>
						<div class="conn-dialog__field conn-dialog__field--inline">
							<label class="conn-dialog__label conn-dialog__label--checkbox">
								<input
									type="checkbox"
									checked={rememberPassword()}
									onChange={(e) => setRememberPassword(e.currentTarget.checked)}
								/>
								Remember password
							</label>
							<span class="conn-dialog__hint">Password will be encrypted and stored in your browser</span>
						</div>
					</Show>
				</Show>

				{/* SQLite fields */}
				<Show when={dbType() === "sqlite"}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">File Path</label>
						<div class="conn-dialog__browse-row">
							<input
								class="conn-dialog__input"
								classList={{ "conn-dialog__input--error": !!errors().path }}
								type="text"
								value={sqliteFields().path}
								onInput={(e) => updateSqliteField("path", e.currentTarget.value)}
								placeholder="/path/to/database.db"
							/>
							<button
								class="conn-dialog__browse-btn"
								onClick={handleBrowse}
							>
								<FolderOpen size={14} /> Browse
							</button>
						</div>
						<Show when={errors().path}>
							<span class="conn-dialog__error">{errors().path}</span>
						</Show>
					</div>
				</Show>

				{/* Test result */}
				<Show when={testResult()}>
					{(result) => (
						<div
							class="conn-dialog__test-result"
							classList={{
								"conn-dialog__test-result--success": result().success,
								"conn-dialog__test-result--error": !result().success,
							}}
						>
							{result().success
								? "Connection successful"
								: `Connection failed: ${result().error}`}
						</div>
					)}
				</Show>

				{/* Actions */}
				<div class="conn-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={handleTestConnection}
						disabled={testing()}
					>
						<Plug size={14} /> {testing() ? "Testing..." : "Test Connection"}
					</button>
					<div class="conn-dialog__actions-right">
						<button
							class="btn btn--secondary"
							onClick={props.onClose}
						>
							Cancel
						</button>
						<button
							class="btn btn--primary"
							onClick={handleSave}
							disabled={saving()}
						>
							{saving() ? "Saving..." : "Save"}
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	);
}
