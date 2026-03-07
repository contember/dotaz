import Dialog from './Dialog'
import './DemoWarningDialog.css'

interface DemoWarningDialogProps {
	open: boolean
	onClose: () => void
}

export default function DemoWarningDialog(props: DemoWarningDialogProps) {
	return (
		<Dialog open={props.open} title="Demo Mode" onClose={props.onClose} class="demo-warning-dialog">
			<div class="demo-warning-dialog__content">
				<p>
					You are running Dotaz in <strong>demo mode</strong>. Please note:
				</p>
				<ul>
					<li>Everything runs entirely in your browser</li>
					<li>Only the pre-loaded example database is available</li>
					<li>Adding new connections is not supported</li>
					<li>All changes are lost when you refresh the page</li>
				</ul>
				<div class="demo-warning-dialog__actions">
					<button class="btn btn--primary" onClick={props.onClose}>
						Got it
					</button>
				</div>
			</div>
		</Dialog>
	)
}
