import Plug from 'lucide-solid/icons/plug'
import { siMysql, siPostgresql, siSqlite } from 'simple-icons'
import { createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { ConnectionConfig, ConnectionInfo, ConnectionType, SshAuthMethod, SshTunnelConfig, SSLMode } from '@dotaz/shared/types/connection'
import { CONNECTION_COLORS, CONNECTION_TYPE_META, SSL_MODES } from '@dotaz/shared/types/connection'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import Dialog from '../common/Dialog'
import './ConnectionDialog.css'
import ServerConnectionForm from './ServerConnectionForm'
import SQLiteConnectionForm from './SQLiteConnectionForm'
import SshTunnelForm from './SshTunnelForm'

interface ConnectionDialogProps {
	open: boolean
	/** Pass a ConnectionInfo to edit, or null for new connection */
	connection: ConnectionInfo | null
	onClose: () => void
}

function defaultPgFields() {
	return {
		name: '',
		host: 'localhost',
		port: '5432',
		database: '',
		user: '',
		password: '',
		ssl: 'prefer' as SSLMode,
	}
}

function defaultSqliteFields() {
	return {
		name: '',
		path: '',
	}
}

function defaultSshFields() {
	return {
		enabled: false,
		host: '',
		port: '22',
		username: '',
		authMethod: 'password' as SshAuthMethod,
		password: '',
		keyPath: '',
		keyPassphrase: '',
		localPort: '',
	}
}

function parseConnectionString(input: string): { fields: ReturnType<typeof defaultPgFields>; type: 'postgresql' | 'mysql' } | null {
	const trimmed = input.trim()
	let type: 'postgresql' | 'mysql'
	let defaultPort: string
	if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
		type = 'postgresql'
		defaultPort = '5432'
	} else if (trimmed.startsWith('mysql://')) {
		type = 'mysql'
		defaultPort = '3306'
	} else {
		return null
	}
	try {
		const url = new URL(trimmed)
		const user = decodeURIComponent(url.username)
		const password = decodeURIComponent(url.password)
		const host = url.hostname
		const port = url.port || defaultPort
		const database = url.pathname.replace(/^\//, '')
		const sslmode = url.searchParams.get('sslmode')
		const ssl: SSLMode = sslmode && SSL_MODES.includes(sslmode as SSLMode) ? sslmode as SSLMode : 'prefer'
		const name = user && host && database ? `${user}@${host}/${database}` : ''
		return { fields: { name, host, port, database, user, password, ssl }, type }
	} catch {
		return null
	}
}

export default function ConnectionDialog(props: ConnectionDialogProps) {
	const [conn, setConn] = createStore({
		type: 'postgresql' as ConnectionType,
		pgFields: defaultPgFields(),
		sqliteFields: defaultSqliteFields(),
		url: '',
	})
	const [ssh, setSsh] = createStore({
		...defaultSshFields(),
		expanded: false,
	})
	const [form, setForm] = createStore({
		testResult: null as { success: boolean; error?: string } | null,
		testing: false,
		saving: false,
		errors: {} as Record<string, string>,
	})

	const [readOnly, setReadOnly] = createSignal(false)
	const [connectionColor, setConnectionColor] = createSignal<string | undefined>(undefined)
	const [rememberPassword, setRememberPassword] = createSignal(true)

	// Reset form when dialog opens or connection changes
	function resetForm() {
		setForm(reconcile({ testResult: null, testing: false, saving: false, errors: {} as Record<string, string> }))
		setConn('url', '')

		const conn = props.connection
		if (conn) {
			setConn('type', conn.config.type)
			setReadOnly(conn.readOnly === true)
			setConnectionColor(conn.color)
			connectionsStore.getRememberPassword(conn.id).then(setRememberPassword)
			if (conn.config.type === 'postgresql' || conn.config.type === 'mysql') {
				const rawSsl = conn.config.ssl
				// Handle legacy boolean values from pre-migration data
				const ssl: SSLMode = typeof rawSsl === 'boolean'
					? (rawSsl ? 'require' : 'disable')
					: (rawSsl ?? 'prefer')
				setConn(
					'pgFields',
					reconcile({
						name: conn.name,
						host: conn.config.host,
						port: String(conn.config.port),
						database: conn.config.database,
						user: conn.config.user,
						password: conn.config.password,
						ssl,
					}),
				)
				// Load SSH tunnel config if present
				if (conn.config.type === 'postgresql' && conn.config.sshTunnel) {
					const t = conn.config.sshTunnel
					setSsh(reconcile({
						enabled: t.enabled,
						host: t.host ?? '',
						port: String(t.port ?? 22),
						username: t.username ?? '',
						authMethod: t.authMethod ?? 'password',
						password: t.password ?? '',
						keyPath: t.keyPath ?? '',
						keyPassphrase: t.keyPassphrase ?? '',
						localPort: t.localPort ? String(t.localPort) : '',
						expanded: t.enabled,
					}))
				} else {
					setSsh(reconcile({ ...defaultSshFields(), expanded: false }))
				}
			} else {
				setConn(
					'sqliteFields',
					reconcile({
						name: conn.name,
						path: conn.config.path,
					}),
				)
				setSsh(reconcile({ ...defaultSshFields(), expanded: false }))
			}
		} else {
			setConn(reconcile({
				type: 'postgresql' as ConnectionType,
				pgFields: defaultPgFields(),
				sqliteFields: defaultSqliteFields(),
				url: '',
			}))
			setSsh(reconcile({ ...defaultSshFields(), expanded: false }))
			setReadOnly(false)
			setConnectionColor(undefined)
			setRememberPassword(true)
		}
	}

	// Build config from current form state
	function buildConfig(): ConnectionConfig {
		const meta = CONNECTION_TYPE_META[conn.type]
		if (meta.hasHost) {
			const f = conn.pgFields
			const type = conn.type as 'postgresql' | 'mysql'
			if (type === 'mysql') {
				return {
					type,
					host: f.host,
					port: Number(f.port) || meta.defaultPort!,
					database: f.database,
					user: f.user,
					password: f.password,
					ssl: f.ssl !== 'disable',
				}
			}
			const sshTunnel: SshTunnelConfig | undefined = ssh.enabled
				? {
					enabled: true,
					host: ssh.host,
					port: Number(ssh.port) || 22,
					username: ssh.username,
					authMethod: ssh.authMethod,
					password: ssh.authMethod === 'password' ? ssh.password : undefined,
					keyPath: ssh.authMethod === 'key' ? ssh.keyPath : undefined,
					keyPassphrase: ssh.authMethod === 'key' && ssh.keyPassphrase ? ssh.keyPassphrase : undefined,
					localPort: ssh.localPort ? Number(ssh.localPort) : undefined,
				}
				: undefined
			return {
				type,
				host: f.host,
				port: Number(f.port) || meta.defaultPort!,
				database: f.database,
				user: f.user,
				password: f.password,
				ssl: f.ssl,
				sshTunnel,
			}
		} else {
			return {
				type: 'sqlite',
				path: conn.sqliteFields.path,
			}
		}
	}

	function getName(): string {
		return CONNECTION_TYPE_META[conn.type].hasHost
			? conn.pgFields.name
			: conn.sqliteFields.name
	}

	function validate(): boolean {
		const errs: Record<string, string> = {}

		if (!getName().trim()) {
			errs.name = 'Name is required'
		}

		if (CONNECTION_TYPE_META[conn.type].hasHost) {
			const f = conn.pgFields
			if (!f.host.trim()) errs.host = 'Host is required'
			if (!f.port.trim() || Number.isNaN(Number(f.port))) errs.port = 'Valid port is required'
			if (!f.database.trim()) errs.database = 'Database is required'
			if (!f.user.trim()) errs.user = 'Username is required'

			// Validate SSH tunnel fields
			if (conn.type === 'postgresql') {
				if (ssh.enabled) {
					if (!ssh.host.trim()) errs.sshHost = 'SSH host is required'
					if (!ssh.port.trim() || Number.isNaN(Number(ssh.port))) errs.sshPort = 'Valid SSH port is required'
					if (!ssh.username.trim()) errs.sshUsername = 'SSH username is required'
					if (ssh.authMethod === 'key' && !ssh.keyPath.trim()) errs.sshKeyPath = 'SSH key path is required'
				}
			}
		} else {
			const f = conn.sqliteFields
			if (!f.path.trim()) errs.path = 'File path is required'
		}

		setForm('errors', errs)
		return Object.keys(errs).length === 0
	}

	async function handleTestConnection() {
		if (!validate()) return

		setForm('testing', true)
		setForm('testResult', null)
		try {
			const result = await rpc.connections.test({ config: buildConfig() })
			setForm('testResult', result)
		} catch (err) {
			setForm('testResult', {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			})
		} finally {
			setForm('testing', false)
		}
	}

	async function handleSave() {
		if (!validate()) return

		setForm('saving', true)
		try {
			const name = getName().trim()
			const config = buildConfig()

			if (props.connection) {
				await connectionsStore.updateConnection(props.connection.id, name, config, rememberPassword(), readOnly(), connectionColor())
			} else {
				await connectionsStore.createConnection(name, config, rememberPassword(), readOnly(), connectionColor())
			}
			props.onClose()
		} catch (err) {
			setForm('testResult', {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			})
		} finally {
			setForm('saving', false)
		}
	}

	async function handleBrowse() {
		const result = await rpc.system.showOpenDialog({
			title: 'Select SQLite Database',
			filters: [
				{ name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3'] },
				{ name: 'All Files', extensions: ['*'] },
			],
		})

		if (!result.cancelled && result.paths.length > 0) {
			setConn('sqliteFields', 'path', result.paths[0])
		}
	}

	function updatePgField(field: string, value: string | boolean) {
		setConn('pgFields', field as keyof ReturnType<typeof defaultPgFields>, value as never)
		setForm('errors', (e) => {
			const next = { ...e }
			delete next[field]
			return next
		})
	}

	function updateSqliteField(field: string, value: string) {
		setConn('sqliteFields', field as keyof ReturnType<typeof defaultSqliteFields>, value)
		setForm('errors', (e) => {
			const next = { ...e }
			delete next[field]
			return next
		})
	}

	function updateSshField(field: string, value: string | boolean) {
		setSsh(field as keyof ReturnType<typeof defaultSshFields>, value as never)
		setForm('errors', (e) => {
			const next = { ...e }
			// Map SSH field names to error keys
			const errorKey = field === 'host'
				? 'sshHost'
				: field === 'port'
				? 'sshPort'
				: field === 'username'
				? 'sshUsername'
				: field === 'keyPath'
				? 'sshKeyPath'
				: undefined
			if (errorKey) delete next[errorKey]
			return next
		})
	}

	async function handleBrowseSshKey() {
		const result = await rpc.system.showOpenDialog({
			title: 'Select SSH Private Key',
			filters: [
				{ name: 'All Files', extensions: ['*'] },
			],
		})

		if (!result.cancelled && result.paths.length > 0) {
			updateSshField('keyPath', result.paths[0])
		}
	}

	function updateName(value: string) {
		if (CONNECTION_TYPE_META[conn.type].hasHost) {
			updatePgField('name', value)
		} else {
			updateSqliteField('name', value)
		}
	}

	function handleUrlInput(value: string) {
		setConn('url', value)
		const parsed = parseConnectionString(value)
		if (parsed) {
			setConn('type', parsed.type)
			setConn(
				'pgFields',
				reconcile({
					...parsed.fields,
					name: conn.pgFields.name || parsed.fields.name,
				}),
			)
		}
	}

	// Use a ref callback to reset form when dialog opens
	// Solid.js doesn't re-mount Show children on prop changes, so we use a getter
	const dialogOpen = () => {
		const isOpen = props.open
		if (isOpen) {
			// Schedule reset after current batch
			queueMicrotask(resetForm)
		}
		return isOpen
	}

	const title = () => props.connection ? 'Edit Connection' : 'New Connection'

	return (
		<Dialog open={dialogOpen()} title={title()} onClose={props.onClose}>
			<div class="conn-dialog">
				{/* DB Type Switcher */}
				<div class="conn-dialog__type-switcher">
					{(Object.entries(CONNECTION_TYPE_META) as [ConnectionType, typeof CONNECTION_TYPE_META[ConnectionType]][]).map(([type, meta]) => {
						const icons: Record<ConnectionType, typeof siPostgresql> = { postgresql: siPostgresql, sqlite: siSqlite, mysql: siMysql }
						const icon = icons[type]
						return (
							<button
								class="conn-dialog__type-btn"
								classList={{ 'conn-dialog__type-btn--active': conn.type === type }}
								onClick={() => setConn('type', type)}
								disabled={!!props.connection}
							>
								<svg width={14} height={14} viewBox="0 0 24 24" fill={`#${icon.hex}`} aria-hidden="true">
									<path d={icon.path} />
								</svg>{' '}
								{meta.label}
							</button>
						)
					})}
				</div>

				{/* Connection URL (server types, new connections only) */}
				<Show when={CONNECTION_TYPE_META[conn.type].hasHost && !props.connection}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">URL</label>
						<input
							class="conn-dialog__input conn-dialog__url-input"
							type="text"
							value={conn.url}
							onInput={(e) => handleUrlInput(e.currentTarget.value)}
							placeholder={conn.type === 'mysql' ? 'mysql://user:password@localhost:3306/mydb' : 'postgresql://user:password@localhost:5432/mydb'}
						/>
					</div>
				</Show>

				{/* Name field (shared) */}
				<div class="conn-dialog__field">
					<label class="conn-dialog__label">Name</label>
					<input
						class="conn-dialog__input"
						classList={{ 'conn-dialog__input--error': !!form.errors.name }}
						type="text"
						value={getName()}
						onInput={(e) => updateName(e.currentTarget.value)}
						placeholder="My Connection"
					/>
					<Show when={form.errors.name}>
						<span class="conn-dialog__error">{form.errors.name}</span>
					</Show>
				</div>

				{/* Server connection fields (PostgreSQL, MySQL) */}
				<Show when={CONNECTION_TYPE_META[conn.type].hasHost}>
					<ServerConnectionForm
						type={conn.type}
						fields={conn.pgFields}
						errors={form.errors}
						rememberPassword={rememberPassword()}
						onFieldChange={updatePgField}
						onRememberPasswordChange={setRememberPassword}
					/>
				</Show>

				{/* SSH Tunnel (PostgreSQL only) */}
				<Show when={conn.type === 'postgresql'}>
					<SshTunnelForm
						fields={ssh}
						expanded={ssh.expanded}
						errors={form.errors}
						onFieldChange={updateSshField}
						onToggleExpanded={() => {
							const expanding = !ssh.expanded
							setSsh('expanded', expanding)
							if (!expanding && !ssh.enabled) return
						}}
						onBrowseKey={handleBrowseSshKey}
					/>
				</Show>

				{/* SQLite fields */}
				<Show when={!CONNECTION_TYPE_META[conn.type].hasHost}>
					<SQLiteConnectionForm
						fields={conn.sqliteFields}
						errors={form.errors}
						onFieldChange={updateSqliteField}
						onBrowse={handleBrowse}
					/>
				</Show>

				{/* Read-only toggle */}
				<div class="conn-dialog__field conn-dialog__field--inline">
					<label class="conn-dialog__label conn-dialog__label--checkbox">
						<input
							type="checkbox"
							checked={readOnly()}
							onChange={(e) => setReadOnly(e.currentTarget.checked)}
						/>
						Read-only
					</label>
					<span class="conn-dialog__hint">Disable editing and warn on DML statements</span>
				</div>

				{/* Color picker */}
				<div class="conn-dialog__field">
					<label class="conn-dialog__label">Color</label>
					<div class="conn-dialog__color-palette">
						<button
							class="conn-dialog__color-swatch conn-dialog__color-swatch--none"
							classList={{ 'conn-dialog__color-swatch--selected': !connectionColor() }}
							onClick={() => setConnectionColor(undefined)}
							title="None"
						/>
						<For each={CONNECTION_COLORS}>
							{(c) => (
								<button
									class="conn-dialog__color-swatch"
									classList={{ 'conn-dialog__color-swatch--selected': connectionColor() === c.value }}
									style={{ background: c.value }}
									onClick={() => setConnectionColor(c.value)}
									title={c.label}
								/>
							)}
						</For>
					</div>
				</div>

				{/* Test result */}
				<Show when={form.testResult}>
					{(result) => (
						<div
							class="conn-dialog__test-result"
							classList={{
								'conn-dialog__test-result--success': result().success,
								'conn-dialog__test-result--error': !result().success,
							}}
						>
							{result().success
								? 'Connection successful'
								: `Connection failed: ${result().error}`}
						</div>
					)}
				</Show>

				{/* Actions */}
				<div class="conn-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={handleTestConnection}
						disabled={form.testing}
					>
						<Plug size={14} /> {form.testing ? 'Testing...' : 'Test Connection'}
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
							disabled={form.saving}
						>
							{form.saving ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	)
}
