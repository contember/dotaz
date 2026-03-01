import { rpc } from "./rpc";

let statelessMode: boolean | null = null;

export async function detectMode(): Promise<void> {
	try {
		const result = await rpc.storage.getMode();
		statelessMode = result.stateless;
	} catch {
		statelessMode = false;
	}
}

export function isStateless(): boolean {
	return statelessMode === true;
}
