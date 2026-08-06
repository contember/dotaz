export function replaceRecordContents<T>(
	target: Readonly<Record<string, T>>,
	source: Readonly<Record<string, T>>,
): Partial<Record<string, T>> {
	const replacement: Partial<Record<string, T>> = { ...source }
	for (const key of Object.keys(target)) {
		if (!(key in source)) replacement[key] = undefined
	}
	return replacement
}
