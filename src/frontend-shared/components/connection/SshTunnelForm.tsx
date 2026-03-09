import type { SshAuthMethod } from '@dotaz/shared/types/connection'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import FolderOpen from 'lucide-solid/icons/folder-open'
import { Show } from 'solid-js'

export interface SshTunnelFields {
	enabled: boolean
	host: string
	port: string
	username: string
	authMethod: SshAuthMethod
	password: string
	keyPath: string
	keyPassphrase: string
	localPort: string
}

interface SshTunnelFormProps {
	fields: SshTunnelFields
	expanded: boolean
	errors: Record<string, string>
	onFieldChange: (field: string, value: string | boolean) => void
	onToggleExpanded: () => void
	onBrowseKey: () => void
}

export default function SshTunnelForm(props: SshTunnelFormProps) {
	return (
		<div class="conn-dialog__ssh-section">
			<button
				class="conn-dialog__ssh-toggle"
				onClick={props.onToggleExpanded}
				type="button"
			>
				{props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				SSH Tunnel
				<Show when={props.fields.enabled}>
					<span class="conn-dialog__ssh-badge">ON</span>
				</Show>
			</button>

			<Show when={props.expanded}>
				<div class="conn-dialog__ssh-fields">
					<div class="conn-dialog__field conn-dialog__field--inline">
						<label class="conn-dialog__label conn-dialog__label--checkbox">
							<input
								type="checkbox"
								checked={props.fields.enabled}
								onChange={(e) => props.onFieldChange('enabled', e.currentTarget.checked)}
							/>
							Use SSH Tunnel
						</label>
					</div>

					<Show when={props.fields.enabled}>
						<div class="conn-dialog__field">
							<label class="conn-dialog__label">SSH Host</label>
							<input
								class="conn-dialog__input"
								classList={{ 'conn-dialog__input--error': !!props.errors.sshHost }}
								type="text"
								value={props.fields.host}
								onInput={(e) => props.onFieldChange('host', e.currentTarget.value)}
								placeholder="bastion.example.com"
							/>
							<Show when={props.errors.sshHost}>
								<span class="conn-dialog__error">{props.errors.sshHost}</span>
							</Show>
						</div>

						<div class="conn-dialog__field">
							<label class="conn-dialog__label">SSH Port</label>
							<input
								class="conn-dialog__input"
								classList={{ 'conn-dialog__input--error': !!props.errors.sshPort }}
								type="text"
								value={props.fields.port}
								onInput={(e) => props.onFieldChange('port', e.currentTarget.value)}
								placeholder="22"
							/>
							<Show when={props.errors.sshPort}>
								<span class="conn-dialog__error">{props.errors.sshPort}</span>
							</Show>
						</div>

						<div class="conn-dialog__field">
							<label class="conn-dialog__label">SSH Username</label>
							<input
								class="conn-dialog__input"
								classList={{ 'conn-dialog__input--error': !!props.errors.sshUsername }}
								type="text"
								value={props.fields.username}
								onInput={(e) => props.onFieldChange('username', e.currentTarget.value)}
								placeholder="ubuntu"
							/>
							<Show when={props.errors.sshUsername}>
								<span class="conn-dialog__error">{props.errors.sshUsername}</span>
							</Show>
						</div>

						<div class="conn-dialog__field">
							<label class="conn-dialog__label">Authentication</label>
							<div class="conn-dialog__ssh-auth-switcher">
								<button
									class="conn-dialog__ssh-auth-btn"
									classList={{ 'conn-dialog__ssh-auth-btn--active': props.fields.authMethod === 'password' }}
									onClick={() => props.onFieldChange('authMethod', 'password')}
									type="button"
								>
									Password
								</button>
								<button
									class="conn-dialog__ssh-auth-btn"
									classList={{ 'conn-dialog__ssh-auth-btn--active': props.fields.authMethod === 'key' }}
									onClick={() => props.onFieldChange('authMethod', 'key')}
									type="button"
								>
									SSH Key
								</button>
							</div>
						</div>

						<Show when={props.fields.authMethod === 'password'}>
							<div class="conn-dialog__field">
								<label class="conn-dialog__label">SSH Password</label>
								<input
									class="conn-dialog__input"
									type="password"
									value={props.fields.password}
									onInput={(e) => props.onFieldChange('password', e.currentTarget.value)}
								/>
							</div>
						</Show>

						<Show when={props.fields.authMethod === 'key'}>
							<div class="conn-dialog__field">
								<label class="conn-dialog__label">Private Key</label>
								<div class="conn-dialog__browse-row">
									<input
										class="conn-dialog__input"
										classList={{ 'conn-dialog__input--error': !!props.errors.sshKeyPath }}
										type="text"
										value={props.fields.keyPath}
										onInput={(e) => props.onFieldChange('keyPath', e.currentTarget.value)}
										placeholder="~/.ssh/id_rsa"
									/>
									<button
										class="conn-dialog__browse-btn"
										onClick={props.onBrowseKey}
										type="button"
									>
										<FolderOpen size={14} /> Browse
									</button>
								</div>
								<Show when={props.errors.sshKeyPath}>
									<span class="conn-dialog__error">{props.errors.sshKeyPath}</span>
								</Show>
							</div>

							<div class="conn-dialog__field">
								<label class="conn-dialog__label">Passphrase</label>
								<input
									class="conn-dialog__input"
									type="password"
									value={props.fields.keyPassphrase}
									onInput={(e) => props.onFieldChange('keyPassphrase', e.currentTarget.value)}
									placeholder="Optional"
								/>
							</div>
						</Show>

						<div class="conn-dialog__field">
							<label class="conn-dialog__label">Local Port</label>
							<input
								class="conn-dialog__input"
								type="text"
								value={props.fields.localPort}
								onInput={(e) => props.onFieldChange('localPort', e.currentTarget.value)}
								placeholder="Auto"
							/>
							<span class="conn-dialog__hint">Leave empty for automatic assignment</span>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	)
}
