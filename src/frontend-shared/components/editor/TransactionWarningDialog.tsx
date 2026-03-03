import Dialog from '../common/Dialog'

interface TransactionWarningDialogProps {
	open: boolean
	context: 'close' | 'disconnect'
	onCommit: () => void
	onRollback: () => void
	onCancel: () => void
}

export default function TransactionWarningDialog(props: TransactionWarningDialogProps) {
	const message = () =>
		props.context === 'close'
			? 'This tab has an uncommitted transaction.'
			: 'This connection has an uncommitted transaction.'

	return (
		<Dialog
			open={props.open}
			title="Uncommitted Transaction"
			onClose={props.onCancel}
		>
			<div style={{ padding: 'var(--spacing-sm)' }}>
				<p style={{ margin: '0 0 var(--spacing-md) 0', color: 'var(--ink)' }}>
					{message()} What would you like to do?
				</p>
				<div style={{ display: 'flex', gap: 'var(--spacing-sm)', 'justify-content': 'flex-end' }}>
					<button class="btn btn--secondary" onClick={props.onCancel}>
						Cancel
					</button>
					<button class="btn btn--danger" onClick={props.onRollback}>
						Rollback
					</button>
					<button class="btn btn--primary" onClick={props.onCommit}>
						Commit
					</button>
				</div>
			</div>
		</Dialog>
	)
}
