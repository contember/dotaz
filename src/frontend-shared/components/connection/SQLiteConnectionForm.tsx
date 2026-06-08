import FolderOpen from 'lucide-solid/icons/folder-open'
import { Show } from 'solid-js'

export interface SQLiteConnectionFields {
	path: string
	initSql: string
}

interface SQLiteConnectionFormProps {
	fields: SQLiteConnectionFields
	errors: Record<string, string>
	onFieldChange: (field: string, value: string) => void
	onBrowse: () => void
}

export default function SQLiteConnectionForm(props: SQLiteConnectionFormProps) {
	return (
		<>
			<div class="conn-dialog__field">
				<label class="conn-dialog__label">File Path</label>
				<div class="conn-dialog__browse-row">
					<input
						class="conn-dialog__input"
						classList={{ 'conn-dialog__input--error': !!props.errors.path }}
						type="text"
						value={props.fields.path}
						onInput={(e) => props.onFieldChange('path', e.currentTarget.value)}
						placeholder="/path/to/database.db"
					/>
					<button
						class="conn-dialog__browse-btn"
						onClick={props.onBrowse}
					>
						<FolderOpen size={14} /> Browse
					</button>
				</div>
				<Show when={props.errors.path}>
					<span class="conn-dialog__error">{props.errors.path}</span>
				</Show>
			</div>

			<div class="conn-dialog__field">
				<label class="conn-dialog__label">Setup SQL</label>
				<textarea
					class="conn-dialog__input conn-dialog__textarea"
					value={props.fields.initSql}
					onInput={(e) => props.onFieldChange('initSql', e.currentTarget.value)}
					placeholder="PRAGMA busy_timeout = 5000;"
					rows={3}
					spellcheck={false}
				/>
				<span class="conn-dialog__hint">
					Runs once on every connection. Useful for PRAGMAs (<code>PRAGMA busy_timeout = 5000</code>), <code>ATTACH DATABASE</code>, or loading extensions.
				</span>
			</div>
		</>
	)
}
