export function isNumericType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return (
		t.includes("int") ||
		t.includes("numeric") ||
		t.includes("decimal") ||
		t.includes("float") ||
		t.includes("double") ||
		t.includes("real") ||
		t.includes("serial")
	);
}

export function isBooleanType(dataType: string): boolean {
	return dataType.toLowerCase().includes("bool");
}

export function isDateType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return t.includes("timestamp") || t === "date" || t === "datetime";
}

export function isTextType(dataType: string): boolean {
	const t = dataType.toLowerCase();
	return t === "text" || t.includes("varchar") || t.includes("char") || t.includes("clob");
}
