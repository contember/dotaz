import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { createKeyHandler, normalizeCombo, comboFromEvent, keyboardManager } from "../src/frontend-shared/lib/keyboard";
import { commandRegistry } from "../src/frontend-shared/lib/commands";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		key: "a",
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		preventDefault: mock(() => {}),
		...overrides,
	} as unknown as KeyboardEvent;
}

describe("createKeyHandler", () => {
	test("dispatches matching binding", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler },
		]);

		keyHandler(makeKeyEvent({ key: "c", ctrlKey: true }));

		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("does not dispatch non-matching key", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler },
		]);

		keyHandler(makeKeyEvent({ key: "v", ctrlKey: true }));

		expect(handler).not.toHaveBeenCalled();
	});

	test("does not dispatch when ctrl required but not pressed", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler },
		]);

		keyHandler(makeKeyEvent({ key: "c", ctrlKey: false }));

		expect(handler).not.toHaveBeenCalled();
	});

	test("does not dispatch when ctrl pressed but not required", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", handler },
		]);

		keyHandler(makeKeyEvent({ key: "c", ctrlKey: true }));

		expect(handler).not.toHaveBeenCalled();
	});

	test("matches metaKey as ctrl", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler },
		]);

		keyHandler(makeKeyEvent({ key: "c", metaKey: true }));

		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("case-insensitive key matching", () => {
		const handler = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler },
		]);

		keyHandler(makeKeyEvent({ key: "C", ctrlKey: true }));

		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("only first matching binding fires", () => {
		const first = mock(() => {});
		const second = mock(() => {});
		const keyHandler = createKeyHandler([
			{ key: "c", ctrl: true, handler: first },
			{ key: "c", ctrl: true, handler: second },
		]);

		keyHandler(makeKeyEvent({ key: "c", ctrlKey: true }));

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
	});
});

describe("normalizeCombo", () => {
	test("normalises simple key combo", () => {
		expect(normalizeCombo("Ctrl+S")).toBe("ctrl+s");
	});

	test("normalises with shift", () => {
		expect(normalizeCombo("Ctrl+Shift+P")).toBe("ctrl+shift+p");
	});

	test("normalises regardless of order", () => {
		expect(normalizeCombo("Shift+Ctrl+P")).toBe("ctrl+shift+p");
	});

	test("normalises single key", () => {
		expect(normalizeCombo("F2")).toBe("f2");
	});

	test("normalises meta/cmd as ctrl", () => {
		expect(normalizeCombo("Meta+S")).toBe("ctrl+s");
		expect(normalizeCombo("Cmd+S")).toBe("ctrl+s");
	});

	test("normalises with alt", () => {
		expect(normalizeCombo("Alt+Ctrl+S")).toBe("alt+ctrl+s");
	});
});

describe("comboFromEvent", () => {
	test("simple key", () => {
		expect(comboFromEvent(makeKeyEvent({ key: "F2" }))).toBe("f2");
	});

	test("ctrl + key", () => {
		expect(comboFromEvent(makeKeyEvent({ key: "s", ctrlKey: true }))).toBe("ctrl+s");
	});

	test("ctrl + shift + key", () => {
		expect(comboFromEvent(makeKeyEvent({ key: "p", ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+p");
	});

	test("meta treated as ctrl", () => {
		expect(comboFromEvent(makeKeyEvent({ key: "s", metaKey: true }))).toBe("ctrl+s");
	});

	test("alt + key", () => {
		expect(comboFromEvent(makeKeyEvent({ key: "b", altKey: true }))).toBe("alt+b");
	});
});

describe("KeyboardManager", () => {
	const handler = mock(() => {});

	beforeEach(() => {
		handler.mockClear();
		commandRegistry.register({
			id: "test-global",
			label: "Test Global",
			category: "Navigation",
			handler,
		});
		commandRegistry.register({
			id: "test-grid",
			label: "Test Grid",
			category: "Grid",
			handler,
		});
		commandRegistry.register({
			id: "test-sql",
			label: "Test SQL",
			category: "Query",
			handler,
		});
		keyboardManager.register("Ctrl+G", "test-global");
		keyboardManager.register("F2", "test-grid", "data-grid");
		keyboardManager.register("Ctrl+Enter", "test-sql", "sql-console");
	});

	afterEach(() => {
		keyboardManager.unregister("Ctrl+G");
		keyboardManager.unregister("F2");
		keyboardManager.unregister("Ctrl+Enter");
		commandRegistry.unregister("test-global");
		commandRegistry.unregister("test-grid");
		commandRegistry.unregister("test-sql");
		keyboardManager.setContextProvider(() => "global");
	});

	test("dispatches global shortcut regardless of context", () => {
		keyboardManager.setContextProvider(() => "global");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "g", ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("dispatches global shortcut even in data-grid context", () => {
		keyboardManager.setContextProvider(() => "data-grid");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "g", ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("dispatches context-specific shortcut when context matches", () => {
		keyboardManager.setContextProvider(() => "data-grid");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "F2" }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("does not dispatch context-specific shortcut when context does not match", () => {
		keyboardManager.setContextProvider(() => "sql-console");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "F2" }));
		expect(handler).not.toHaveBeenCalled();
	});

	test("does not dispatch context-specific shortcut in global context", () => {
		keyboardManager.setContextProvider(() => "global");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "F2" }));
		expect(handler).not.toHaveBeenCalled();
	});

	test("sql-console shortcut dispatches in sql-console context", () => {
		keyboardManager.setContextProvider(() => "sql-console");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "Enter", ctrlKey: true }));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	test("sql-console shortcut does not dispatch in data-grid context", () => {
		keyboardManager.setContextProvider(() => "data-grid");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "Enter", ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
	});

	test("calls preventDefault on matched shortcut", () => {
		keyboardManager.setContextProvider(() => "global");
		const e = makeKeyEvent({ key: "g", ctrlKey: true });
		keyboardManager.handleKeyDown(e);
		expect(e.preventDefault).toHaveBeenCalled();
	});

	test("does not call preventDefault on unmatched shortcut", () => {
		const e = makeKeyEvent({ key: "x", ctrlKey: true });
		keyboardManager.handleKeyDown(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
	});

	test("does not dispatch unregistered shortcut", () => {
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "z", ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
	});

	test("unregister removes shortcut", () => {
		keyboardManager.unregister("Ctrl+G");
		keyboardManager.handleKeyDown(makeKeyEvent({ key: "g", ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
		// Re-register for cleanup
		keyboardManager.register("Ctrl+G", "test-global");
	});
});
