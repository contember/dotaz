import { describe, expect, test } from "bun:test";
import {
	parseCsvStream,
	coerceValue,
	CsvParseError,
	type CsvBatch,
	type CsvStreamOptions,
} from "../src/backend-shared/services/csv-stream-parser";

// ── Helpers ────────────────────────────────────────────────

/** Create a ReadableStream from a string. */
function streamFromString(content: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(content));
			controller.close();
		},
	});
}

/** Create a ReadableStream from multiple chunks (for testing chunk boundaries). */
function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream({
		pull(controller) {
			if (i < chunks.length) {
				controller.enqueue(chunks[i++]);
			} else {
				controller.close();
			}
		},
	});
}

/** Create a ReadableStream from multiple string chunks. */
function streamFromStringChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return streamFromChunks(chunks.map((c) => encoder.encode(c)));
}

/** Collect all batches from the async generator. */
async function collectAll(
	stream: ReadableStream<Uint8Array>,
	options: CsvStreamOptions,
): Promise<CsvBatch[]> {
	const batches: CsvBatch[] = [];
	for await (const batch of parseCsvStream(stream, options)) {
		batches.push(batch);
	}
	return batches;
}

/** Collect all rows flattened from all batches. */
async function collectRows(
	stream: ReadableStream<Uint8Array>,
	options: CsvStreamOptions,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
	const batches = await collectAll(stream, options);
	if (batches.length === 0) return { columns: [], rows: [] };
	const columns = batches[0].columns;
	const rows = batches.flatMap((b) => b.rows);
	return { columns, rows };
}

const defaultOptions: CsvStreamOptions = {
	delimiter: ",",
	hasHeader: true,
	batchSize: 100,
};

// ── Basic CSV parsing ──────────────────────────────────────

describe("parseCsvStream", () => {
	describe("basic parsing", () => {
		test("simple CSV with header", async () => {
			const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);

			expect(columns).toEqual(["name", "age", "city"]);
			expect(rows).toEqual([
				{ name: "Alice", age: 30, city: "NYC" },
				{ name: "Bob", age: 25, city: "LA" },
			]);
		});

		test("CSV without trailing newline", async () => {
			const csv = "name,age\nAlice,30\nBob,25";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);

			expect(columns).toEqual(["name", "age"]);
			expect(rows).toHaveLength(2);
			expect(rows[1]).toEqual({ name: "Bob", age: 25 });
		});

		test("empty stream", async () => {
			const { columns, rows } = await collectRows(
				streamFromString(""),
				defaultOptions,
			);
			expect(columns).toEqual([]);
			expect(rows).toEqual([]);
		});

		test("header only (no data rows)", async () => {
			const csv = "name,age,city\n";
			const batches = await collectAll(streamFromString(csv), defaultOptions);
			// No data rows, so no batches yielded (or empty batch)
			const rows = batches.flatMap((b) => b.rows);
			expect(rows).toEqual([]);
		});

		test("single data row", async () => {
			const csv = "id,val\n1,hello\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(columns).toEqual(["id", "val"]);
			expect(rows).toEqual([{ id: 1, val: "hello" }]);
		});
	});

	// ── hasHeader: false ───────────────────────────────────

	describe("hasHeader: false", () => {
		test("generates col1, col2, ... column names", async () => {
			const csv = "Alice,30,NYC\nBob,25,LA\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, hasHeader: false },
			);

			expect(columns).toEqual(["col1", "col2", "col3"]);
			expect(rows).toEqual([
				{ col1: "Alice", col2: 30, col3: "NYC" },
				{ col1: "Bob", col2: 25, col3: "LA" },
			]);
		});

		test("single row without header", async () => {
			const csv = "42,hello";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, hasHeader: false },
			);
			expect(columns).toEqual(["col1", "col2"]);
			expect(rows).toEqual([{ col1: 42, col2: "hello" }]);
		});
	});

	// ── Quoted fields (RFC 4180) ───────────────────────────

	describe("quoted fields", () => {
		test("quoted field with delimiter inside", async () => {
			const csv = 'name,desc\nAlice,"hello, world"\n';
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ name: "Alice", desc: "hello, world" });
		});

		test("escaped quotes inside quoted field", async () => {
			const csv = 'name,quote\nAlice,"She said ""hi"""\n';
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ name: "Alice", quote: 'She said "hi"' });
		});

		test("multiline field within quotes", async () => {
			const csv = 'name,bio\nAlice,"line1\nline2\nline3"\n';
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ name: "Alice", bio: "line1\nline2\nline3" });
		});

		test("multiline field with CRLF within quotes", async () => {
			const csv = 'name,bio\nAlice,"line1\r\nline2"\n';
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ name: "Alice", bio: "line1\r\nline2" });
		});

		test("empty quoted field", async () => {
			const csv = 'a,b\n"",val\n';
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ a: null, b: "val" });
		});
	});

	// ── Line endings ───────────────────────────────────────

	describe("line endings", () => {
		test("CRLF line endings", async () => {
			const csv = "a,b\r\n1,2\r\n3,4\r\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows).toEqual([
				{ a: 1, b: 2 },
				{ a: 3, b: 4 },
			]);
		});

		test("LF line endings", async () => {
			const csv = "a,b\n1,2\n3,4\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows).toHaveLength(2);
		});

		test("standalone CR line endings", async () => {
			const csv = "a,b\r1,2\r3,4\r";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows).toHaveLength(2);
		});
	});

	// ── Delimiters ─────────────────────────────────────────

	describe("delimiters", () => {
		test("semicolon delimiter", async () => {
			const csv = "a;b;c\n1;2;3\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, delimiter: ";" },
			);
			expect(columns).toEqual(["a", "b", "c"]);
			expect(rows[0]).toEqual({ a: 1, b: 2, c: 3 });
		});

		test("tab delimiter", async () => {
			const csv = "a\tb\tc\n1\t2\t3\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, delimiter: "\t" },
			);
			expect(columns).toEqual(["a", "b", "c"]);
			expect(rows[0]).toEqual({ a: 1, b: 2, c: 3 });
		});
	});

	// ── Value coercion ─────────────────────────────────────

	describe("value coercion", () => {
		test("coerces booleans", async () => {
			const csv = "val\ntrue\nfalse\nTRUE\nFALSE\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].val).toBe(true);
			expect(rows[1].val).toBe(false);
			expect(rows[2].val).toBe(true);
			expect(rows[3].val).toBe(false);
		});

		test("coerces integers", async () => {
			const csv = "val\n42\n-7\n0\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].val).toBe(42);
			expect(rows[1].val).toBe(-7);
			expect(rows[2].val).toBe(0);
		});

		test("coerces floats", async () => {
			const csv = "val\n3.14\n-0.5\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].val).toBe(3.14);
			expect(rows[1].val).toBe(-0.5);
		});

		test("empty string becomes null", async () => {
			const csv = "a,b\n,val\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].a).toBeNull();
		});

		test("missing fields become null", async () => {
			const csv = "a,b,c\n1\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ a: 1, b: null, c: null });
		});

		test("preserves plain strings", async () => {
			const csv = "val\nhello world\n123abc\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].val).toBe("hello world");
			expect(rows[1].val).toBe("123abc");
		});
	});

	// ── Batching ───────────────────────────────────────────

	describe("batching", () => {
		test("yields multiple batches when rows exceed batchSize", async () => {
			const lines = ["id\n"];
			for (let i = 1; i <= 10; i++) {
				lines.push(`${i}\n`);
			}
			const csv = lines.join("");

			const batches = await collectAll(
				streamFromString(csv),
				{ ...defaultOptions, batchSize: 3 },
			);

			// 10 rows / 3 per batch = 4 batches (3, 3, 3, 1)
			expect(batches).toHaveLength(4);
			expect(batches[0].rows).toHaveLength(3);
			expect(batches[1].rows).toHaveLength(3);
			expect(batches[2].rows).toHaveLength(3);
			expect(batches[3].rows).toHaveLength(1);
		});

		test("all batches have the same columns", async () => {
			const csv = "a,b\n1,2\n3,4\n5,6\n7,8\n";
			const batches = await collectAll(
				streamFromString(csv),
				{ ...defaultOptions, batchSize: 2 },
			);

			expect(batches).toHaveLength(2);
			expect(batches[0].columns).toEqual(["a", "b"]);
			expect(batches[1].columns).toEqual(["a", "b"]);
		});

		test("single batch when rows < batchSize", async () => {
			const csv = "a\n1\n2\n";
			const batches = await collectAll(
				streamFromString(csv),
				{ ...defaultOptions, batchSize: 100 },
			);
			expect(batches).toHaveLength(1);
			expect(batches[0].rows).toHaveLength(2);
		});
	});

	// ── maxRows ────────────────────────────────────────────

	describe("maxRows", () => {
		test("stops after maxRows data rows", async () => {
			const lines = ["id\n"];
			for (let i = 1; i <= 100; i++) {
				lines.push(`${i}\n`);
			}
			const csv = lines.join("");

			const { rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, maxRows: 5 },
			);

			expect(rows).toHaveLength(5);
			expect(rows[0].id).toBe(1);
			expect(rows[4].id).toBe(5);
		});

		test("maxRows with hasHeader: false", async () => {
			const csv = "a,1\nb,2\nc,3\nd,4\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, hasHeader: false, maxRows: 2 },
			);
			expect(rows).toHaveLength(2);
		});

		test("maxRows larger than total rows returns all", async () => {
			const csv = "id\n1\n2\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, maxRows: 100 },
			);
			expect(rows).toHaveLength(2);
		});

		test("maxRows=1 returns exactly one row", async () => {
			const csv = "a,b\n1,2\n3,4\n5,6\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				{ ...defaultOptions, maxRows: 1 },
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({ a: 1, b: 2 });
		});

		test("maxRows with small batchSize yields partial batch", async () => {
			const csv = "id\n1\n2\n3\n4\n5\n";
			const batches = await collectAll(
				streamFromString(csv),
				{ ...defaultOptions, batchSize: 2, maxRows: 3 },
			);

			// 2 rows in first batch, 1 row in second (stopped at 3)
			const totalRows = batches.reduce((sum, b) => sum + b.rows.length, 0);
			expect(totalRows).toBe(3);
		});
	});

	// ── Chunk boundary handling ────────────────────────────

	describe("chunk boundaries", () => {
		test("field split across chunks", async () => {
			const stream = streamFromStringChunks(["name,val\nAli", "ce,30\n"]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0]).toEqual({ name: "Alice", val: 30 });
		});

		test("quoted field split across chunks", async () => {
			const stream = streamFromStringChunks([
				'name,desc\nAlice,"hel',
				'lo, world"\n',
			]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0]).toEqual({ name: "Alice", desc: "hello, world" });
		});

		test("escaped quote at chunk boundary", async () => {
			// Full CSV: name,val\nAlice,"say ""hi"""\nBob,test\n
			// Quoted field: "say ""hi""" → say "hi"
			const stream = streamFromStringChunks([
				'name,val\nAlice,"say ""',
				'hi"""\nBob,test\n',
			]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0].val).toBe('say "hi"');
			expect(rows[1]).toEqual({ name: "Bob", val: "test" });
		});

		test("CRLF split across chunks", async () => {
			const stream = streamFromStringChunks(["a,b\r", "\n1,2\r\n"]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0]).toEqual({ a: 1, b: 2 });
		});

		test("multiline quoted field split across chunks", async () => {
			const stream = streamFromStringChunks([
				'a,b\n"line1\n',
				'line2",val\n',
			]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0]).toEqual({ a: "line1\nline2", b: "val" });
		});

		test("header split across chunks", async () => {
			const stream = streamFromStringChunks(["na", "me,age\nAlice,30\n"]);
			const { columns, rows } = await collectRows(stream, defaultOptions);
			expect(columns).toEqual(["name", "age"]);
			expect(rows[0]).toEqual({ name: "Alice", age: 30 });
		});

		test("many small chunks (byte-at-a-time)", async () => {
			const csv = "a,b\n1,2\n3,4\n";
			const encoder = new TextEncoder();
			const bytes = encoder.encode(csv);
			const chunks = Array.from(bytes).map((b) => new Uint8Array([b]));
			const stream = streamFromChunks(chunks);

			const { columns, rows } = await collectRows(stream, defaultOptions);
			expect(columns).toEqual(["a", "b"]);
			expect(rows).toHaveLength(2);
		});
	});

	// ── UTF-8 multi-byte at chunk boundaries ───────────────

	describe("UTF-8 multi-byte handling", () => {
		test("2-byte character (é) split across chunks", async () => {
			const csv = "name\ncafé\n";
			const encoder = new TextEncoder();
			const encoded = encoder.encode(csv);

			// Find the 2-byte é (0xC3 0xA9) and split between them
			const eAccentIndex = encoded.indexOf(0xc3);
			const chunk1 = encoded.slice(0, eAccentIndex + 1); // includes first byte of é
			const chunk2 = encoded.slice(eAccentIndex + 1); // starts with second byte of é

			const stream = streamFromChunks([chunk1, chunk2]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0].name).toBe("café");
		});

		test("3-byte character (€) split across chunks", async () => {
			const csv = "price\n€100\n";
			const encoder = new TextEncoder();
			const encoded = encoder.encode(csv);

			// € is 3 bytes (0xE2 0x82 0xAC)
			const euroIndex = encoded.indexOf(0xe2);
			const chunk1 = encoded.slice(0, euroIndex + 1);
			const chunk2 = encoded.slice(euroIndex + 1);

			const stream = streamFromChunks([chunk1, chunk2]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0].price).toBe("€100");
		});

		test("4-byte character (emoji 😀) split across chunks", async () => {
			const csv = "val\n😀\n";
			const encoder = new TextEncoder();
			const encoded = encoder.encode(csv);

			// 😀 is 4 bytes (0xF0 0x9F 0x98 0x80)
			const emojiIndex = encoded.indexOf(0xf0);
			// Split after 2nd byte of the emoji
			const chunk1 = encoded.slice(0, emojiIndex + 2);
			const chunk2 = encoded.slice(emojiIndex + 2);

			const stream = streamFromChunks([chunk1, chunk2]);
			const { rows } = await collectRows(stream, defaultOptions);
			expect(rows[0].val).toBe("😀");
		});

		test("multiple multi-byte characters", async () => {
			const csv = "name\nüñö\n日本語\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0].name).toBe("üñö");
			expect(rows[1].name).toBe("日本語");
		});
	});

	// ── Error handling ─────────────────────────────────────

	describe("error handling", () => {
		test("throws CsvParseError for unclosed quote", async () => {
			const csv = 'name\n"unclosed\n';
			try {
				await collectRows(streamFromString(csv), defaultOptions);
				expect(true).toBe(false); // should not reach
			} catch (err) {
				expect(err).toBeInstanceOf(CsvParseError);
				expect((err as CsvParseError).lineNumber).toBeGreaterThan(0);
				expect((err as CsvParseError).message).toContain("Unclosed quote");
			}
		});

		test("unclosed quote at end of stream with data", async () => {
			const csv = 'a,b\n1,"unclosed';
			try {
				await collectRows(streamFromString(csv), defaultOptions);
				expect(true).toBe(false);
			} catch (err) {
				expect(err).toBeInstanceOf(CsvParseError);
			}
		});
	});

	// ── Edge cases ─────────────────────────────────────────

	describe("edge cases", () => {
		test("row with more fields than header", async () => {
			const csv = "a,b\n1,2,3\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			// Extra fields are ignored
			expect(rows[0]).toEqual({ a: 1, b: 2 });
		});

		test("row with fewer fields than header", async () => {
			const csv = "a,b,c\n1\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ a: 1, b: null, c: null });
		});

		test("all empty fields", async () => {
			const csv = "a,b,c\n,,\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ a: null, b: null, c: null });
		});

		test("whitespace in unquoted fields is preserved", async () => {
			const csv = "a,b\n hello , world \n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(rows[0]).toEqual({ a: " hello ", b: " world " });
		});

		test("single column CSV", async () => {
			const csv = "id\n1\n2\n3\n";
			const { columns, rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(columns).toEqual(["id"]);
			expect(rows).toHaveLength(3);
		});

		test("large number of columns", async () => {
			const n = 50;
			const header = Array.from({ length: n }, (_, i) => `c${i}`).join(",");
			const row = Array.from({ length: n }, (_, i) => `${i}`).join(",");
			const csv = `${header}\n${row}\n`;

			const { columns, rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			expect(columns).toHaveLength(n);
			expect(rows).toHaveLength(1);
			expect(rows[0].c0).toBe(0);
			expect(rows[0].c49).toBe(49);
		});

		test("consecutive newlines produce no extra rows", async () => {
			const csv = "a\n1\n\n2\n\n";
			const { rows } = await collectRows(
				streamFromString(csv),
				defaultOptions,
			);
			// Empty lines (single empty field) are skipped
			expect(rows).toHaveLength(2);
		});
	});
});

// ── coerceValue standalone tests ───────────────────────────

describe("coerceValue", () => {
	test("null and empty string return null", () => {
		expect(coerceValue(null)).toBeNull();
		expect(coerceValue("")).toBeNull();
	});

	test("booleans", () => {
		expect(coerceValue("true")).toBe(true);
		expect(coerceValue("false")).toBe(false);
		expect(coerceValue("TRUE")).toBe(true);
		expect(coerceValue("FALSE")).toBe(false);
	});

	test("integers", () => {
		expect(coerceValue("0")).toBe(0);
		expect(coerceValue("42")).toBe(42);
		expect(coerceValue("-7")).toBe(-7);
	});

	test("floats", () => {
		expect(coerceValue("3.14")).toBe(3.14);
		expect(coerceValue("-0.5")).toBe(-0.5);
	});

	test("strings pass through", () => {
		expect(coerceValue("hello")).toBe("hello");
		expect(coerceValue("123abc")).toBe("123abc");
		expect(coerceValue("3.14.15")).toBe("3.14.15");
	});
});
