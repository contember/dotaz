import TriangleAlert from 'lucide-solid/icons/triangle-alert'
import X from 'lucide-solid/icons/x'
import { Show } from 'solid-js'
import { getCapabilities } from '../../lib/capabilities'
import { openExternal } from '../../lib/rpc'
import { keyStatusStore } from '../../stores/key-status'
import './KeyNotice.css'

export default function KeyNotice() {
	function openLink(e: MouseEvent, url: string) {
		// The desktop webview would navigate away from the app; the browser opens it instead.
		if (!getCapabilities().isDesktop) return
		e.preventDefault()
		void openExternal(url)
	}

	return (
		<Show when={keyStatusStore.notice}>
			{(notice) => (
				<div class="key-notice" role="alert">
					<TriangleAlert class="key-notice__icon" size={16} />
					<div class="key-notice__body">
						<p class="key-notice__title">{notice().title}</p>
						<p class="key-notice__detail">
							{notice().detail}{' '}
							<a href={notice().linkUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => openLink(e, notice().linkUrl)}>
								{notice().linkLabel}
							</a>
						</p>
					</div>
					<button class="key-notice__dismiss" title="Hide until next start" aria-label="Hide until next start" onClick={() => keyStatusStore.dismiss()}>
						<X size={14} />
					</button>
				</div>
			)}
		</Show>
	)
}
