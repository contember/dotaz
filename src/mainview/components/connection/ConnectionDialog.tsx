import { createSignal, Show } from "solid-js";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionType,
	SSLMode,
} from "../../../shared/types/connection";
import { CONNECTION_TYPE_META, SSL_MODES } from "../../../shared/types/connection";
import { connectionsStore } from "../../stores/connections";
import { storage } from "../../lib/storage";
import { rpc } from "../../lib/rpc";
import { siPostgresql, siSqlite, siMysql } from "simple-icons";
import FolderOpen from "lucide-solid/icons/folder-open";
import Plug from "lucide-solid/icons/plug";
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
		ssl: "prefer" as SSLMode,
	};
}

function defaultSqliteFields() {
	return {
		name: "",
		path: "",
	};
}

function parseConnectionString(input: string): { fields: ReturnType<typeof defaultPgFields>; type: "postgresql" | "mysql" } | null {
	const trimmed = input.trim();
	let type: "postgresql" | "mysql";
	let defaultPort: string;
	if (trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://")) {
		type = "postgresql";
		defaultPort = "5432";
	} else if (trimmed.startsWith("mysql://")) {
		type = "mysql";
		defaultPort = "3306";
	} else {
		return null;
	}
	try {
		const url = new URL(trimmed);
		const user = decodeURIComponent(url.username);
		const password = decodeURIComponent(url.password);
		const host = url.hostname;
		const port = url.port || defaultPort;
		const database = url.pathname.replace(/^\//, "");
		const sslmode = url.searchParams.get("sslmode");
		const ssl: SSLMode = sslmode && SSL_MODES.includes(sslmode as SSLMode) ? sslmode as SSLMode : "prefer";
		const name = user && host && database ? `${user}@${host}/${database}` : "";
		return { fields: { name, host, port, database, user, password, ssl }, type };
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
			connectionsStore.getRememberPassword(conn.id).then(setRememberPassword);
			if (conn.config.type === "postgresql" || conn.config.type === "mysql") {
				const rawSsl = conn.config.ssl;
				// Handle legacy boolean values from pre-migration data
				const ssl: SSLMode = typeof rawSsl === "boolean"
					? (rawSsl ? "require" : "disable")
					: (rawSsl ?? "prefer");
				setPgFields({
					name: conn.name,
					host: conn.config.host,
					port: String(conn.config.port),
					database: conn.config.database,
					user: conn.config.user,
					password: conn.config.password,
					ssl,
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
		const meta = CONNECTION_TYPE_META[dbType()];
		if (meta.hasHost) {
			const f = pgFields();
			const type = dbType() as "postgresql" | "mysql";
			if (type === "mysql") {
				return {
					type,
					host: f.host,
					port: Number(f.port) || meta.defaultPort!,
					database: f.database,
					user: f.user,
					password: f.password,
					ssl: f.ssl !== "disable",
				};
			}
			return {
				type,
				host: f.host,
				port: Number(f.port) || meta.defaultPort!,
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
		return CONNECTION_TYPE_META[dbType()].hasHost
			? pgFields().name
			: sqliteFields().name;
	}

	function validate(): boolean {
		const errs: Record<string, string> = {};

		if (!getName().trim()) {
			errs.name = "Name is required";
		}

		if (CONNECTION_TYPE_META[dbType()].hasHost) {
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
			const result = await rpc.connections.test({ config: buildConfig() });
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
		if (CONNECTION_TYPE_META[dbType()].hasHost) {
			updatePgField("name", value);
		} else {
			updateSqliteField("name", value);
		}
	}

	function handleUrlInput(value: string) {
		setConnectionUrl(value);
		const parsed = parseConnectionString(value);
		if (parsed) {
			setDbType(parsed.type);
			const current = pgFields();
			setPgFields({
				...parsed.fields,
				name: current.name || parsed.fields.name,
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
					{(Object.entries(CONNECTION_TYPE_META) as [ConnectionType, typeof CONNECTION_TYPE_META[ConnectionType]][]).map(([type, meta]) => {
						const icons: Record<ConnectionType, typeof siPostgresql> = { postgresql: siPostgresql, sqlite: siSqlite, mysql: siMysql };
						const icon = icons[type];
						return (
							<button
								class="conn-dialog__type-btn"
								classList={{ "conn-dialog__type-btn--active": dbType() === type }}
								onClick={() => setDbType(type)}
								disabled={!!props.connection}
							>
								<svg width={14} height={14} viewBox="0 0 24 24" fill={`#${icon.hex}`} aria-hidden="true"><path d={icon.path} /></svg> {meta.label}
							</button>
						);
					})}
				</div>

				{/* Connection URL (server types, new connections only) */}
				<Show when={CONNECTION_TYPE_META[dbType()].hasHost && !props.connection}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">URL</label>
						<input
							class="conn-dialog__input conn-dialog__url-input"
							type="text"
							value={connectionUrl()}
							onInput={(e) => handleUrlInput(e.currentTarget.value)}
							placeholder={dbType() === "mysql" ? "mysql://user:password@localhost:3306/mydb" : "postgresql://user:password@localhost:5432/mydb"}
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

				{/* Server connection fields (PostgreSQL, MySQL) */}
				<Show when={CONNECTION_TYPE_META[dbType()].hasHost}>
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
							placeholder={String(CONNECTION_TYPE_META[dbType()].defaultPort ?? 5432)}
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

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">SSL Mode</label>
						<select
							class="conn-dialog__input"
							value={pgFields().ssl}
							onChange={(e) => updatePgField("ssl", e.currentTarget.value)}
						>
							{SSL_MODES.map((mode) => (
								<option value={mode}>{mode}</option>
							))}
						</select>
					</div>

					<Show when={storage.passConfigOnConnect}>
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
				<Show when={!CONNECTION_TYPE_META[dbType()].hasHost}>
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
