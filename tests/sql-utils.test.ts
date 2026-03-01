import { describe, test, expect } from "bun:test";
import { getStatementAtCursor } from "../src/frontend-shared/lib/sql-utils";

describe("getStatementAtCursor", () => {
	test("single statement, cursor at start", () => {
		const result = getStatementAtCursor("SELECT 1", 0);
		expect(result?.text).toBe("SELECT 1");
		expect(result?.from).toBe(0);
		expect(result?.to).toBe(8);
	});

	test("single statement, cursor at end", () => {
		const result = getStatementAtCursor("SELECT 1", 8);
		expect(result?.text).toBe("SELECT 1");
		expect(result?.from).toBe(0);
		expect(result?.to).toBe(8);
	});

	test("two statements, cursor in first", () => {
		const result = getStatementAtCursor("SELECT 1; SELECT 2", 3);
		expect(result?.text).toBe("SELECT 1");
		expect(result?.from).toBe(0);
		expect(result?.to).toBe(8);
	});

	test("two statements, cursor in second", () => {
		const result = getStatementAtCursor("SELECT 1; SELECT 2", 12);
		expect(result?.text).toBe("SELECT 2");
		expect(result?.from).toBe(10);
		expect(result?.to).toBe(18);
	});

	test("three statements, cursor in middle", () => {
		const result = getStatementAtCursor("SELECT 1; SELECT 2; SELECT 3", 14);
		expect(result?.text).toBe("SELECT 2");
		expect(result?.from).toBe(10);
		expect(result?.to).toBe(18);
	});

	test("cursor right on semicolon goes to previous statement", () => {
		// Cursor at position 8 is at the semicolon itself — belongs to first statement
		const result = getStatementAtCursor("SELECT 1; SELECT 2", 8);
		expect(result?.text).toBe("SELECT 1");
	});

	test("cursor right after semicolon goes to next statement", () => {
		const result = getStatementAtCursor("SELECT 1; SELECT 2", 9);
		expect(result?.text).toBe("SELECT 2");
	});

	test("handles semicolons inside single-quoted strings", () => {
		const sql = "SELECT 'a;b'; SELECT 2";
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 'a;b'");
		expect(getStatementAtCursor(sql, 16)?.text).toBe("SELECT 2");
	});

	test("handles semicolons inside double-quoted identifiers", () => {
		const sql = 'SELECT "a;b"; SELECT 2';
		expect(getStatementAtCursor(sql, 0)?.text).toBe('SELECT "a;b"');
		expect(getStatementAtCursor(sql, 16)?.text).toBe("SELECT 2");
	});

	test("handles semicolons inside line comments", () => {
		const sql = "SELECT 1 -- a; comment\n; SELECT 2";
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 1 -- a; comment");
		expect(getStatementAtCursor(sql, 30)?.text).toBe("SELECT 2");
	});

	test("handles semicolons inside block comments", () => {
		const sql = "SELECT 1 /* a; b */; SELECT 2";
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 1 /* a; b */");
		expect(getStatementAtCursor(sql, 25)?.text).toBe("SELECT 2");
	});

	test("handles dollar-quoted strings", () => {
		const sql = "SELECT $$a;b$$; SELECT 2";
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT $$a;b$$");
		expect(getStatementAtCursor(sql, 20)?.text).toBe("SELECT 2");
	});

	test("handles escaped quotes in single-quoted strings", () => {
		const sql = "SELECT 'a''b;c'; SELECT 2";
		expect(getStatementAtCursor(sql, 0)?.text).toBe("SELECT 'a''b;c'");
		expect(getStatementAtCursor(sql, 20)?.text).toBe("SELECT 2");
	});

	test("empty input returns null", () => {
		expect(getStatementAtCursor("", 0)).toBeNull();
	});

	test("whitespace only returns null", () => {
		expect(getStatementAtCursor("   ;  ", 0)).toBeNull();
	});

	test("trailing semicolon", () => {
		expect(getStatementAtCursor("SELECT 1;", 3)?.text).toBe("SELECT 1");
	});

	test("returns correct range for statement with leading whitespace", () => {
		const sql = "SELECT 1;  SELECT 2  ";
		const result = getStatementAtCursor(sql, 14);
		expect(result?.text).toBe("SELECT 2");
		expect(result?.from).toBe(11);
		expect(result?.to).toBe(19);
	});
});
