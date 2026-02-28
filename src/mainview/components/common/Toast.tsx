import { For } from "solid-js";
import { uiStore } from "../../stores/ui";
import type { ToastType } from "../../stores/ui";
import "./Toast.css";

const ICON_MAP: Record<ToastType, string> = {
	success: "\u2713",
	error: "\u2717",
	warning: "\u26A0",
	info: "\u2139",
};

export default function ToastContainer() {
	return (
		<div class="toast-container">
			<For each={uiStore.toasts}>
				{(toast) => (
					<div class={`toast toast--${toast.type}`} role="alert">
						<span class="toast__icon">{ICON_MAP[toast.type]}</span>
						<span class="toast__message">{toast.message}</span>
						<button
							class="toast__dismiss"
							onClick={() => uiStore.removeToast(toast.id)}
							title="Dismiss"
						>
							&times;
						</button>
					</div>
				)}
			</For>
		</div>
	);
}
