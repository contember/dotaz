/** Singleton command registry for the command palette. */

export type CommandCategory = "Connection" | "Query" | "Grid" | "Navigation" | "View" | "Help";

export interface Command {
	id: string;
	label: string;
	shortcut?: string;
	category: CommandCategory;
	handler: () => void;
}

const commands = new Map<string, Command>();
const recentIds: string[] = [];
const MAX_RECENT = 5;

function register(command: Command) {
	commands.set(command.id, command);
}

function unregister(id: string) {
	commands.delete(id);
}

/** Clear all registered commands. Call on AppShell cleanup to prevent duplicate registrations after HMR. */
function clear() {
	commands.clear();
	recentIds.length = 0;
}

function getAll(): Command[] {
	return [...commands.values()];
}

function getById(id: string): Command | undefined {
	return commands.get(id);
}

/** Mark a command as recently used (moves it to front). */
function markRecent(id: string) {
	const idx = recentIds.indexOf(id);
	if (idx !== -1) {
		recentIds.splice(idx, 1);
	}
	recentIds.unshift(id);
	if (recentIds.length > MAX_RECENT) {
		recentIds.pop();
	}
}

function getRecentIds(): readonly string[] {
	return recentIds;
}

/** Simple fuzzy match: all characters of query appear in label in order (case-insensitive). */
function fuzzyMatch(label: string, query: string): boolean {
	const lowerLabel = label.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let labelIdx = 0;
	for (let i = 0; i < lowerQuery.length; i++) {
		const found = lowerLabel.indexOf(lowerQuery[i], labelIdx);
		if (found === -1) return false;
		labelIdx = found + 1;
	}
	return true;
}

/** Search commands with fuzzy matching, recently used first. */
function search(query: string): Command[] {
	const all = getAll();
	const filtered = query ? all.filter((c) => fuzzyMatch(c.label, query)) : all;

	// Sort: recent first, then alphabetical
	const recentSet = new Set(recentIds);
	return filtered.sort((a, b) => {
		const aRecent = recentSet.has(a.id);
		const bRecent = recentSet.has(b.id);
		if (aRecent && !bRecent) return -1;
		if (!aRecent && bRecent) return 1;
		if (aRecent && bRecent) {
			return recentIds.indexOf(a.id) - recentIds.indexOf(b.id);
		}
		return a.label.localeCompare(b.label);
	});
}

function execute(id: string) {
	const command = commands.get(id);
	if (command) {
		markRecent(id);
		command.handler();
	}
}

export const commandRegistry = {
	register,
	unregister,
	clear,
	getAll,
	getById,
	getRecentIds,
	search,
	execute,
};
