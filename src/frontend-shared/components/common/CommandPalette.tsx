import { createSignal, Show, For, onMount, onCleanup, createEffect } from "solid-js";
import { commandRegistry } from "../../lib/commands";
import type { Command } from "../../lib/commands";
import "./CommandPalette.css";

interface CommandPaletteProps {
	open: boolean;
	onClose: () => void;
}

export default function CommandPalette(props: CommandPaletteProps) {
	const [query, setQuery] = createSignal("");
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [results, setResults] = createSignal<Command[]>([]);

	let inputRef: HTMLInputElement | undefined;
	let listRef: HTMLDivElement | undefined;

	// Update results when query changes or palette opens
	createEffect(() => {
		if (props.open) {
			const q = query();
			setResults(commandRegistry.search(q));
			setSelectedIndex(0);
		}
	});

	// Focus input when opened, reset state
	createEffect(() => {
		if (props.open) {
			setQuery("");
			// Defer focus to next frame so the input is rendered
			requestAnimationFrame(() => inputRef?.focus());
		}
	});

	function handleKeyDown(e: KeyboardEvent) {
		if (!props.open) return;

		if (e.key === "Escape") {
			e.preventDefault();
			props.onClose();
			return;
		}

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, results().length - 1));
			scrollToSelected();
			return;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
			scrollToSelected();
			return;
		}

		if (e.key === "Enter") {
			e.preventDefault();
			const items = results();
			const idx = selectedIndex();
			if (items[idx]) {
				props.onClose();
				commandRegistry.execute(items[idx].id);
			}
			return;
		}
	}

	function scrollToSelected() {
		requestAnimationFrame(() => {
			const el = listRef?.querySelector(".command-palette__item--selected");
			el?.scrollIntoView({ block: "nearest" });
		});
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			props.onClose();
		}
	}

	function handleItemClick(command: Command) {
		props.onClose();
		commandRegistry.execute(command.id);
	}

	onMount(() => {
		document.addEventListener("keydown", handleKeyDown);
	});

	onCleanup(() => {
		document.removeEventListener("keydown", handleKeyDown);
	});

	return (
		<Show when={props.open}>
			<div class="command-palette-overlay" onClick={handleOverlayClick}>
				<div class="command-palette">
					<div class="command-palette__input-wrap">
						<input
							ref={inputRef}
							class="command-palette__input"
							type="text"
							placeholder="Type a command..."
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
						/>
					</div>
					<div class="command-palette__list" ref={listRef}>
						<Show when={results().length === 0}>
							<div class="command-palette__empty">No matching commands</div>
						</Show>
						<For each={results()}>
							{(cmd, i) => (
								<div
									class={`command-palette__item${i() === selectedIndex() ? " command-palette__item--selected" : ""}`}
									onClick={() => handleItemClick(cmd)}
									onMouseEnter={() => setSelectedIndex(i())}
								>
									<div class="command-palette__item-left">
										<span class="command-palette__label">{cmd.label}</span>
										<span class="command-palette__category">{cmd.category}</span>
									</div>
									<Show when={cmd.shortcut}>
										<span class="command-palette__shortcut">{cmd.shortcut}</span>
									</Show>
								</div>
							)}
						</For>
					</div>
				</div>
			</div>
		</Show>
	);
}
