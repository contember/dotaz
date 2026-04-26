import { Show } from 'solid-js'
import { formatTabContext } from '../../lib/tab-context'
import { tabsStore } from '../../stores/tabs'
import './TitleBar.css'

const isMac = navigator.platform.startsWith('Mac')

export default function TitleBar() {
	// On non-macOS platforms, we use native window decorations (titleBarStyle: 'default'),
	// so the custom titlebar is not needed.
	if (!isMac) return null

	return (
		<div class="titlebar electrobun-webkit-app-region-drag titlebar--mac">
			{/* Native traffic lights are rendered by the OS via hiddenInset titlebar */}
			<div class="titlebar__traffic-spacer" />
			<div class="titlebar__title">
				<span class="titlebar__app-name">Dotaz</span>
				<Show when={formatTabContext(tabsStore.activeTab)}>
					{(ctx) => (
						<>
							<span class="titlebar__sep">—</span>
							<span class="titlebar__context">{ctx()}</span>
						</>
					)}
				</Show>
			</div>
		</div>
	)
}
