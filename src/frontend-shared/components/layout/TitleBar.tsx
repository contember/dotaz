import Minus from 'lucide-solid/icons/minus'
import Square from 'lucide-solid/icons/square'
import X from 'lucide-solid/icons/x'
import { Show } from 'solid-js'
import { closeWindow, maximizeWindow, minimizeWindow } from '../../lib/rpc'
import './TitleBar.css'

const isMac = navigator.platform.startsWith('Mac')
const isLinux = navigator.platform.startsWith('Linux')

export default function TitleBar() {
	// On Linux, we use native window decorations (titleBarStyle: 'default'),
	// so the custom titlebar is not needed.
	if (isLinux) return null

	return (
		<div class={`titlebar electrobun-webkit-app-region-drag ${isMac ? 'titlebar--mac' : ''}`}>
			{/* On macOS, native traffic lights are rendered by the OS via hiddenInset titlebar */}
			<Show when={isMac}>
				<div class="titlebar__traffic-spacer" />
			</Show>
			<div class="titlebar__title">Dotaz</div>
			<Show when={!isMac}>
				<div class="titlebar__controls electrobun-webkit-app-region-no-drag">
					<button class="titlebar__btn" onClick={minimizeWindow} title="Minimize">
						<Minus size={14} />
					</button>
					<button class="titlebar__btn" onClick={maximizeWindow} title="Maximize">
						<Square size={12} />
					</button>
					<button class="titlebar__btn titlebar__btn--close" onClick={closeWindow} title="Close">
						<X size={14} />
					</button>
				</div>
			</Show>
		</div>
	)
}
