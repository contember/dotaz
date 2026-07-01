export function replaceRecordContents<T>(
	target: Record<string, T>,
	source: Record<string, T>,
): Record<string, T> {
	for (const key of Object.keys(target)) {
		if (!(key in source)) delete target[key]
	}
	for (const [key, value] of Object.entries(source)) {
		target[key] = value
	}
	return target
}
