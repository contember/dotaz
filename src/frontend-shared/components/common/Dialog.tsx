import { type JSX, Show, onMount, onCleanup } from "solid-js";
import Icon from "./Icon";
import "./Dialog.css";

interface DialogProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: JSX.Element;
}

/** Focusable element selector for focus trapping. */
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog(props: DialogProps) {
	let dialogRef: HTMLDivElement | undefined;
	let previouslyFocused: HTMLElement | null = null;

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			props.onClose();
			return;
		}

		// Focus trap
		if (e.key === "Tab" && dialogRef) {
			const focusable = dialogRef.querySelectorAll<HTMLElement>(FOCUSABLE);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			props.onClose();
		}
	}

	onMount(() => {
		previouslyFocused = document.activeElement as HTMLElement | null;
		document.addEventListener("keydown", handleKeyDown);

		// Focus the first focusable element inside the dialog
		requestAnimationFrame(() => {
			if (dialogRef) {
				const firstFocusable = dialogRef.querySelector<HTMLElement>(FOCUSABLE);
				firstFocusable?.focus();
			}
		});
	});

	onCleanup(() => {
		document.removeEventListener("keydown", handleKeyDown);
		previouslyFocused?.focus();
	});

	return (
		<Show when={props.open}>
			<div class="dialog-overlay" onClick={handleOverlayClick}>
				<div class="dialog" ref={dialogRef}>
					<div class="dialog__header">
						<span class="dialog__title">{props.title}</span>
						<button
							class="dialog__close"
							onClick={props.onClose}
							title="Close"
						>
							<Icon name="close" size={12} />
						</button>
					</div>
					<div class="dialog__body">
						{props.children}
					</div>
				</div>
			</div>
		</Show>
	);
}
