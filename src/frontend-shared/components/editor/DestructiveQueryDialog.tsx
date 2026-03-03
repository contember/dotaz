import { createSignal } from 'solid-js'
import { For } from 'solid-js'
import Dialog from '../common/Dialog'
import './DestructiveQueryDialog.css'

interface DestructiveQueryDialogProps {
	open: boolean
	statements: string[]
	onConfirm: (suppressForSession: boolean) => void
	onCancel: () => void
}

export default function DestructiveQueryDialog(props: DestructiveQueryDialogProps) {
	const [suppress, setSuppress] = createSignal(false)

	return (
		<Dialog
			open={props.open}
			title="Destructive Query Warning"
			onClose={props.onCancel}
		>
			<div class="destructive-dialog">
				<p class="destructive-dialog__warning">
					The following statement{props.statements.length > 1 ? 's' : ''} will affect <strong>all rows</strong> in the table because{' '}
					{props.statements.length > 1 ? 'they have' : 'it has'} no WHERE clause:
				</p>

				<div class="destructive-dialog__statements">
					<For each={props.statements}>
						{(stmt) => <pre class="destructive-dialog__sql">{stmt}</pre>}
					</For>
				</div>

				<label class="destructive-dialog__suppress">
					<input
						type="checkbox"
						checked={suppress()}
						onChange={(e) => setSuppress(e.currentTarget.checked)}
					/>
					Don't show again for this session
				</label>

				<div class="destructive-dialog__actions">
					<button
						class="btn btn--secondary"
						onClick={props.onCancel}
					>
						Cancel
					</button>
					<button
						class="btn btn--danger"
						onClick={() => props.onConfirm(suppress())}
					>
						Execute Anyway
					</button>
				</div>
			</div>
		</Dialog>
	)
}
