import { For } from "solid-js";
import { uiStore } from "../../stores/ui";
import type { ToastType } from "../../stores/ui";
import Icon, { type IconName } from "./Icon";
import "./Toast.css";

const ICON_MAP: Record<ToastType, IconName> = {
	success: "check",
	error: "error",
	warning: "warning",
	info: "info",
};

export default function ToastContainer() {
	return (
		<div class="toast-container">
			<For each={uiStore.toasts}>
				{(toast) => (
					<div class={`toast toast--${toast.type}`} role="alert">
						<span class="toast__icon">
							<Icon name={ICON_MAP[toast.type]} size={14} />
						</span>
						<span class="toast__message">{toast.message}</span>
						<button
							class="toast__dismiss"
							onClick={() => uiStore.removeToast(toast.id)}
							title="Dismiss"
						>
							<Icon name="close" size={10} />
						</button>
					</div>
				)}
			</For>
		</div>
	);
}
