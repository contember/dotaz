import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Plug from 'lucide-solid/icons/plug'
import { siMysql, siPostgresql, siSqlite } from 'simple-icons'
import { createSignal, For, Show } from 'solid-js'
import type { ConnectionConfig, ConnectionInfo, ConnectionType, SshAuthMethod, SshTunnelConfig, SSLMode } from '../../../shared/types/connection'
import { CONNECTION_COLORS, CONNECTION_TYPE_META, SSL_MODES } from '../../../shared/types/connection'
import { rpc } from '../../lib/rpc'
import { storage } from '../../lib/storage'
import { connectionsStore } from '../../stores/connections'
import Dialog from '../common/Dialog'
import Select from '../common/Select'
import './ConnectionDialog.css'

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
	const [dbType, setDbType] = createSignal<ConnectionType>('postgresql')
	const [pgFields, setPgFields] = createSignal(defaultPgFields())
	const [sqliteFields, setSqliteFields] = createSignal(defaultSqliteFields())
	const [connectionUrl, setConnectionUrl] = createSignal('')

	const [sshFields, setSshFields] = createSignal(defaultSshFields())
	const [sshExpanded, setSshExpanded] = createSignal(false)

	const [readOnly, setReadOnly] = createSignal(false)
	const [connectionColor, setConnectionColor] = createSignal<string | undefined>(undefined)
	const [rememberPassword, setRememberPassword] = createSignal(true)
	const [testResult, setTestResult] = createSignal<
		{
			success: boolean
			error?: string
		} | null
	>(null)
	const [testing, setTesting] = createSignal(false)
	const [saving, setSaving] = createSignal(false)
	const [errors, setErrors] = createSignal<Record<string, string>>({})

	// Reset form when dialog opens or connection changes
	function resetForm() {
		setTestResult(null)
		setErrors({})
		setTesting(false)
		setSaving(false)
		setConnectionUrl('')

		const conn = props.connection
		if (conn) {
			setDbType(conn.config.type)
			setReadOnly(conn.readOnly === true)
			setConnectionColor(conn.color)
			connectionsStore.getRememberPassword(conn.id).then(setRememberPassword)
			if (conn.config.type === 'postgresql' || conn.config.type === 'mysql') {
				const rawSsl = conn.config.ssl
				// Handle legacy boolean values from pre-migration data
				const ssl: SSLMode = typeof rawSsl === 'boolean'
					? (rawSsl ? 'require' : 'disable')
					: (rawSsl ?? 'prefer')
				setPgFields({
					name: conn.name,
					host: conn.config.host,
					port: String(conn.config.port),
					database: conn.config.database,
					user: conn.config.user,
					password: conn.config.password,
					ssl,
				})
				// Load SSH tunnel config if present
				if (conn.config.type === 'postgresql' && conn.config.sshTunnel) {
					const t = conn.config.sshTunnel
					setSshFields({
						enabled: t.enabled,
						host: t.host ?? '',
						port: String(t.port ?? 22),
						username: t.username ?? '',
						authMethod: t.authMethod ?? 'password',
						password: t.password ?? '',
						keyPath: t.keyPath ?? '',
						keyPassphrase: t.keyPassphrase ?? '',
						localPort: t.localPort ? String(t.localPort) : '',
					})
					setSshExpanded(t.enabled)
				} else {
					setSshFields(defaultSshFields())
					setSshExpanded(false)
				}
			} else {
				setSqliteFields({
					name: conn.name,
					path: conn.config.path,
				})
				setSshFields(defaultSshFields())
				setSshExpanded(false)
			}
		} else {
			setDbType('postgresql')
			setReadOnly(false)
			setConnectionColor(undefined)
			setRememberPassword(true)
			setPgFields(defaultPgFields())
			setSqliteFields(defaultSqliteFields())
			setSshFields(defaultSshFields())
			setSshExpanded(false)
		}
	}

	// Build config from current form state
	function buildConfig(): ConnectionConfig {
		const meta = CONNECTION_TYPE_META[dbType()]
		if (meta.hasHost) {
			const f = pgFields()
			const type = dbType() as 'postgresql' | 'mysql'
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
			const ssh = sshFields()
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
				path: sqliteFields().path,
			}
		}
	}

	function getName(): string {
		return CONNECTION_TYPE_META[dbType()].hasHost
			? pgFields().name
			: sqliteFields().name
	}

	function validate(): boolean {
		const errs: Record<string, string> = {}

		if (!getName().trim()) {
			errs.name = 'Name is required'
		}

		if (CONNECTION_TYPE_META[dbType()].hasHost) {
			const f = pgFields()
			if (!f.host.trim()) errs.host = 'Host is required'
			if (!f.port.trim() || Number.isNaN(Number(f.port))) errs.port = 'Valid port is required'
			if (!f.database.trim()) errs.database = 'Database is required'
			if (!f.user.trim()) errs.user = 'Username is required'

			// Validate SSH tunnel fields
			if (dbType() === 'postgresql') {
				const ssh = sshFields()
				if (ssh.enabled) {
					if (!ssh.host.trim()) errs.sshHost = 'SSH host is required'
					if (!ssh.port.trim() || Number.isNaN(Number(ssh.port))) errs.sshPort = 'Valid SSH port is required'
					if (!ssh.username.trim()) errs.sshUsername = 'SSH username is required'
					if (ssh.authMethod === 'key' && !ssh.keyPath.trim()) errs.sshKeyPath = 'SSH key path is required'
				}
			}
		} else {
			const f = sqliteFields()
			if (!f.path.trim()) errs.path = 'File path is required'
		}

		setErrors(errs)
		return Object.keys(errs).length === 0
	}

	async function handleTestConnection() {
		if (!validate()) return

		setTesting(true)
		setTestResult(null)
		try {
			const result = await rpc.connections.test({ config: buildConfig() })
			setTestResult(result)
		} catch (err) {
			setTestResult({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			})
		} finally {
			setTesting(false)
		}
	}

	async function handleSave() {
		if (!validate()) return

		setSaving(true)
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
			setTestResult({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			})
		} finally {
			setSaving(false)
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
			setSqliteFields((f) => ({ ...f, path: result.paths[0] }))
		}
	}

	function updatePgField(field: string, value: string | boolean) {
		setPgFields((f) => ({ ...f, [field]: value }))
		setErrors((e) => {
			const next = { ...e }
			delete next[field]
			return next
		})
	}

	function updateSqliteField(field: string, value: string) {
		setSqliteFields((f) => ({ ...f, [field]: value }))
		setErrors((e) => {
			const next = { ...e }
			delete next[field]
			return next
		})
	}

	function updateSshField(field: string, value: string | boolean) {
		setSshFields((f) => ({ ...f, [field]: value }))
		setErrors((e) => {
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
		if (CONNECTION_TYPE_META[dbType()].hasHost) {
			updatePgField('name', value)
		} else {
			updateSqliteField('name', value)
		}
	}

	function handleUrlInput(value: string) {
		setConnectionUrl(value)
		const parsed = parseConnectionString(value)
		if (parsed) {
			setDbType(parsed.type)
			const current = pgFields()
			setPgFields({
				...parsed.fields,
				name: current.name || parsed.fields.name,
			})
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
								classList={{ 'conn-dialog__type-btn--active': dbType() === type }}
								onClick={() => setDbType(type)}
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
				<Show when={CONNECTION_TYPE_META[dbType()].hasHost && !props.connection}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">URL</label>
						<input
							class="conn-dialog__input conn-dialog__url-input"
							type="text"
							value={connectionUrl()}
							onInput={(e) => handleUrlInput(e.currentTarget.value)}
							placeholder={dbType() === 'mysql' ? 'mysql://user:password@localhost:3306/mydb' : 'postgresql://user:password@localhost:5432/mydb'}
						/>
					</div>
				</Show>

				{/* Name field (shared) */}
				<div class="conn-dialog__field">
					<label class="conn-dialog__label">Name</label>
					<input
						class="conn-dialog__input"
						classList={{ 'conn-dialog__input--error': !!errors().name }}
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
							classList={{ 'conn-dialog__input--error': !!errors().host }}
							type="text"
							value={pgFields().host}
							onInput={(e) => updatePgField('host', e.currentTarget.value)}
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
							classList={{ 'conn-dialog__input--error': !!errors().port }}
							type="text"
							value={pgFields().port}
							onInput={(e) => updatePgField('port', e.currentTarget.value)}
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
							classList={{ 'conn-dialog__input--error': !!errors().database }}
							type="text"
							value={pgFields().database}
							onInput={(e) => updatePgField('database', e.currentTarget.value)}
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
							classList={{ 'conn-dialog__input--error': !!errors().user }}
							type="text"
							value={pgFields().user}
							onInput={(e) => updatePgField('user', e.currentTarget.value)}
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
							onInput={(e) => updatePgField('password', e.currentTarget.value)}
						/>
					</div>

					<div class="conn-dialog__field">
						<label class="conn-dialog__label">SSL Mode</label>
						<Select
							class="conn-dialog__input"
							value={pgFields().ssl}
							onChange={(v) => updatePgField('ssl', v)}
							options={SSL_MODES.map((mode) => ({ value: mode, label: mode }))}
						/>
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

				{/* SSH Tunnel (PostgreSQL only) */}
				<Show when={dbType() === 'postgresql'}>
					<div class="conn-dialog__ssh-section">
						<button
							class="conn-dialog__ssh-toggle"
							onClick={() => {
								const expanding = !sshExpanded()
								setSshExpanded(expanding)
								if (!expanding && !sshFields().enabled) return
							}}
							type="button"
						>
							{sshExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
							SSH Tunnel
							<Show when={sshFields().enabled}>
								<span class="conn-dialog__ssh-badge">ON</span>
							</Show>
						</button>

						<Show when={sshExpanded()}>
							<div class="conn-dialog__ssh-fields">
								<div class="conn-dialog__field conn-dialog__field--inline">
									<label class="conn-dialog__label conn-dialog__label--checkbox">
										<input
											type="checkbox"
											checked={sshFields().enabled}
											onChange={(e) => updateSshField('enabled', e.currentTarget.checked)}
										/>
										Use SSH Tunnel
									</label>
								</div>

								<Show when={sshFields().enabled}>
									<div class="conn-dialog__field">
										<label class="conn-dialog__label">SSH Host</label>
										<input
											class="conn-dialog__input"
											classList={{ 'conn-dialog__input--error': !!errors().sshHost }}
											type="text"
											value={sshFields().host}
											onInput={(e) => updateSshField('host', e.currentTarget.value)}
											placeholder="bastion.example.com"
										/>
										<Show when={errors().sshHost}>
											<span class="conn-dialog__error">{errors().sshHost}</span>
										</Show>
									</div>

									<div class="conn-dialog__field">
										<label class="conn-dialog__label">SSH Port</label>
										<input
											class="conn-dialog__input"
											classList={{ 'conn-dialog__input--error': !!errors().sshPort }}
											type="text"
											value={sshFields().port}
											onInput={(e) => updateSshField('port', e.currentTarget.value)}
											placeholder="22"
										/>
										<Show when={errors().sshPort}>
											<span class="conn-dialog__error">{errors().sshPort}</span>
										</Show>
									</div>

									<div class="conn-dialog__field">
										<label class="conn-dialog__label">SSH Username</label>
										<input
											class="conn-dialog__input"
											classList={{ 'conn-dialog__input--error': !!errors().sshUsername }}
											type="text"
											value={sshFields().username}
											onInput={(e) => updateSshField('username', e.currentTarget.value)}
											placeholder="ubuntu"
										/>
										<Show when={errors().sshUsername}>
											<span class="conn-dialog__error">{errors().sshUsername}</span>
										</Show>
									</div>

									<div class="conn-dialog__field">
										<label class="conn-dialog__label">Authentication</label>
										<div class="conn-dialog__ssh-auth-switcher">
											<button
												class="conn-dialog__ssh-auth-btn"
												classList={{ 'conn-dialog__ssh-auth-btn--active': sshFields().authMethod === 'password' }}
												onClick={() => updateSshField('authMethod', 'password')}
												type="button"
											>
												Password
											</button>
											<button
												class="conn-dialog__ssh-auth-btn"
												classList={{ 'conn-dialog__ssh-auth-btn--active': sshFields().authMethod === 'key' }}
												onClick={() => updateSshField('authMethod', 'key')}
												type="button"
											>
												SSH Key
											</button>
										</div>
									</div>

									<Show when={sshFields().authMethod === 'password'}>
										<div class="conn-dialog__field">
											<label class="conn-dialog__label">SSH Password</label>
											<input
												class="conn-dialog__input"
												type="password"
												value={sshFields().password}
												onInput={(e) => updateSshField('password', e.currentTarget.value)}
											/>
										</div>
									</Show>

									<Show when={sshFields().authMethod === 'key'}>
										<div class="conn-dialog__field">
											<label class="conn-dialog__label">Private Key</label>
											<div class="conn-dialog__browse-row">
												<input
													class="conn-dialog__input"
													classList={{ 'conn-dialog__input--error': !!errors().sshKeyPath }}
													type="text"
													value={sshFields().keyPath}
													onInput={(e) => updateSshField('keyPath', e.currentTarget.value)}
													placeholder="~/.ssh/id_rsa"
												/>
												<button
													class="conn-dialog__browse-btn"
													onClick={handleBrowseSshKey}
													type="button"
												>
													<FolderOpen size={14} /> Browse
												</button>
											</div>
											<Show when={errors().sshKeyPath}>
												<span class="conn-dialog__error">{errors().sshKeyPath}</span>
											</Show>
										</div>

										<div class="conn-dialog__field">
											<label class="conn-dialog__label">Passphrase</label>
											<input
												class="conn-dialog__input"
												type="password"
												value={sshFields().keyPassphrase}
												onInput={(e) => updateSshField('keyPassphrase', e.currentTarget.value)}
												placeholder="Optional"
											/>
										</div>
									</Show>

									<div class="conn-dialog__field">
										<label class="conn-dialog__label">Local Port</label>
										<input
											class="conn-dialog__input"
											type="text"
											value={sshFields().localPort}
											onInput={(e) => updateSshField('localPort', e.currentTarget.value)}
											placeholder="Auto"
										/>
										<span class="conn-dialog__hint">Leave empty for automatic assignment</span>
									</div>
								</Show>
							</div>
						</Show>
					</div>
				</Show>

				{/* SQLite fields */}
				<Show when={!CONNECTION_TYPE_META[dbType()].hasHost}>
					<div class="conn-dialog__field">
						<label class="conn-dialog__label">File Path</label>
						<div class="conn-dialog__browse-row">
							<input
								class="conn-dialog__input"
								classList={{ 'conn-dialog__input--error': !!errors().path }}
								type="text"
								value={sqliteFields().path}
								onInput={(e) => updateSqliteField('path', e.currentTarget.value)}
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
				<Show when={testResult()}>
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
						disabled={testing()}
					>
						<Plug size={14} /> {testing() ? 'Testing...' : 'Test Connection'}
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
							{saving() ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	)
}
