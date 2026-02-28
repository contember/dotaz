import { describe, expect, test, mock } from "bun:test";
import { createKeyHandler } from "../src/mainview/lib/keyboard";

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
