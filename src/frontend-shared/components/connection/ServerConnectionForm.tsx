import type { ConnectionType } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, SSL_MODES } from '@dotaz/shared/types/connection'
import { Show } from 'solid-js'
import { storage } from '../../lib/storage'
import Select from '../common/Select'

export interface ServerConnectionFields {
	host: string
	port: string
	database: string
	user: string
	password: string
	ssl: string
	initSql: string
}

interface ServerConnectionFormProps {
	type: ConnectionType
	fields: ServerConnectionFields
	errors: Record<string, string>
	rememberPassword: boolean
	onFieldChange: (field: string, value: string | boolean) => void
	onRememberPasswordChange: (value: boolean) => void
	availableDatabases: string[] | null
	loadingDatabases: boolean
	fetchDatabasesError: string | null
	onFetchDatabases: () => void
	onClearAvailableDatabases: () => void
}

export default function ServerConnectionForm(props: ServerConnectionFormProps) {
	return (
		<>
			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Host</label>
				<input
					class="conn-dialog__input"
					classList={{ 'conn-dialog__input--error': !!props.errors.host }}
					type="text"
					value={props.fields.host}
					onInput={(e) => props.onFieldChange('host', e.currentTarget.value)}
					placeholder="localhost"
				/>
				<Show when={props.errors.host}>
					<span class="conn-dialog__error">{props.errors.host}</span>
				</Show>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Port</label>
				<input
					class="conn-dialog__input"
					classList={{ 'conn-dialog__input--error': !!props.errors.port }}
					type="text"
					value={props.fields.port}
					onInput={(e) => props.onFieldChange('port', e.currentTarget.value)}
					placeholder={String(CONNECTION_TYPE_META[props.type].defaultPort ?? 5432)}
				/>
				<Show when={props.errors.port}>
					<span class="conn-dialog__error">{props.errors.port}</span>
				</Show>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Database</label>
				<div class="conn-dialog__database-row">
					<Show
						when={props.availableDatabases !== null}
						fallback={
							<input
								class="conn-dialog__input conn-dialog__database-input"
								classList={{ 'conn-dialog__input--error': !!props.errors.database }}
								type="text"
								value={props.fields.database}
								onInput={(e) => props.onFieldChange('database', e.currentTarget.value)}
								placeholder="mydb"
							/>
						}
					>
						<Select
							class="conn-dialog__input conn-dialog__database-input"
							value={props.fields.database}
							onChange={(v) => props.onFieldChange('database', v)}
							options={(props.availableDatabases ?? []).map((d) => ({ value: d, label: d }))}
							placeholder="Select database…"
						/>
					</Show>
					<Show
						when={props.availableDatabases !== null}
						fallback={
							<button
								type="button"
								class="btn btn--secondary conn-dialog__database-action"
								onClick={props.onFetchDatabases}
								disabled={props.loadingDatabases}
							>
								{props.loadingDatabases ? 'Fetching…' : 'Fetch'}
							</button>
						}
					>
						<button
							type="button"
							class="btn btn--secondary conn-dialog__database-action"
							onClick={props.onClearAvailableDatabases}
							title="Type database name manually"
						>
							Clear
						</button>
					</Show>
				</div>
				<Show when={props.errors.database}>
					<span class="conn-dialog__error">{props.errors.database}</span>
				</Show>
				<Show when={props.fetchDatabasesError}>
					<span class="conn-dialog__error">{props.fetchDatabasesError}</span>
				</Show>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Username</label>
				<input
					class="conn-dialog__input"
					classList={{ 'conn-dialog__input--error': !!props.errors.user }}
					type="text"
					value={props.fields.user}
					onInput={(e) => props.onFieldChange('user', e.currentTarget.value)}
					placeholder="postgres"
				/>
				<Show when={props.errors.user}>
					<span class="conn-dialog__error">{props.errors.user}</span>
				</Show>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Password</label>
				<input
					class="conn-dialog__input"
					type="password"
					value={props.fields.password}
					onInput={(e) => props.onFieldChange('password', e.currentTarget.value)}
				/>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">SSL Mode</label>
				<Select
					class="conn-dialog__input"
					value={props.fields.ssl}
					onChange={(v) => props.onFieldChange('ssl', v)}
					options={SSL_MODES.map((mode) => ({ value: mode, label: mode }))}
				/>
			</div>

			<Show when={props.type === 'postgresql' || props.type === 'mysql'}>
				<div class="conn-dialog__field">
					<label class="conn-dialog__label">Session setup SQL</label>
					<textarea
						class="conn-dialog__input conn-dialog__textarea"
						value={props.fields.initSql}
						onInput={(e) => props.onFieldChange('initSql', e.currentTarget.value)}
						placeholder={props.type === 'mysql' ? "SET SESSION time_zone = '+00:00';" : "SET app.current_shop = 'acme';"}
						rows={3}
						spellcheck={false}
					/>
					<span class="conn-dialog__hint">
						Runs at the start of every session and after each connection reset.{' '}
						<Show
							when={props.type === 'mysql'}
							fallback={
								<>
									Useful for RLS (<code>SET app.current_shop = 'acme'</code>), <code>search_path</code>, or roles.
								</>
							}
						>
							Useful for <code>SET SESSION time_zone</code>, <code>SET ROLE</code>, or <code>sql_mode</code>.
						</Show>
					</span>
				</div>
			</Show>

			<Show when={storage.passConfigOnConnect}>
				<div class="conn-dialog__field conn-dialog__field--inline">
					<label class="conn-dialog__label conn-dialog__label--checkbox">
						<input
							type="checkbox"
							checked={props.rememberPassword}
							onChange={(e) => props.onRememberPasswordChange(e.currentTarget.checked)}
						/>
						Remember password
					</label>
					<span class="conn-dialog__hint">Password will be encrypted and stored in your browser</span>
				</div>
			</Show>
		</>
	)
}
