import { createSignal, Show } from "solid-js";
import { editorStore } from "../../stores/editor";
import Icon from "../common/Icon";
import "./AiPrompt.css";

interface AiPromptProps {
	tabId: string;
}

export default function AiPrompt(props: AiPromptProps) {
	const [prompt, setPrompt] = createSignal("");
	let inputRef: HTMLTextAreaElement | undefined;

	const tab = () => editorStore.getTab(props.tabId);
	const isGenerating = () => tab()?.aiGenerating ?? false;
	const aiError = () => tab()?.aiError ?? null;

	function handleSubmit() {
		const text = prompt().trim();
		if (!text || isGenerating()) return;
		editorStore.generateAiSql(props.tabId, text);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			editorStore.closeAiPrompt(props.tabId);
		}
	}

	function handleClose() {
		editorStore.closeAiPrompt(props.tabId);
	}

	// Auto-focus input when mounted
	setTimeout(() => inputRef?.focus(), 0);

	return (
		<div class="ai-prompt">
			<div class="ai-prompt__input-wrapper">
				<textarea
					ref={inputRef}
					class="ai-prompt__input"
					placeholder="Describe the SQL query you want to generate..."
					value={prompt()}
					onInput={(e) => setPrompt(e.currentTarget.value)}
					onKeyDown={handleKeyDown}
					rows={1}
					disabled={isGenerating()}
				/>
				<Show when={aiError()}>
					<p class="ai-prompt__error">{aiError()}</p>
				</Show>
				<p class="ai-prompt__hint">
					Enter to generate, Shift+Enter for newline, Esc to close
				</p>
			</div>
			<div class="ai-prompt__actions">
				<button
					class="ai-prompt__btn"
					onClick={handleSubmit}
					disabled={!prompt().trim() || isGenerating()}
					title="Generate SQL"
				>
					<Show when={isGenerating()} fallback={<>Generate</>}>
						<Icon name="spinner" size={12} /> Generating...
					</Show>
				</button>
				<button
					class="ai-prompt__btn ai-prompt__btn--close"
					onClick={handleClose}
					title="Close (Esc)"
				>
					<Icon name="close" size={14} />
				</button>
			</div>
		</div>
	);
}
