import { Show } from 'solid-js'
import type { ConnectionType } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, SSL_MODES } from '@dotaz/shared/types/connection'
import { storage } from '../../lib/storage'
import Select from '../common/Select'

export interface ServerConnectionFields {
	host: string
	port: string
	database: string
	user: string
	password: string
	ssl: string
}

interface ServerConnectionFormProps {
	type: ConnectionType
	fields: ServerConnectionFields
	errors: Record<string, string>
	rememberPassword: boolean
	onFieldChange: (field: string, value: string | boolean) => void
	onRememberPasswordChange: (value: boolean) => void
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
				<input
					class="conn-dialog__input"
					classList={{ 'conn-dialog__input--error': !!props.errors.database }}
					type="text"
					value={props.fields.database}
					onInput={(e) => props.onFieldChange('database', e.currentTarget.value)}
					placeholder="mydb"
				/>
				<Show when={props.errors.database}>
					<span class="conn-dialog__error">{props.errors.database}</span>
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
