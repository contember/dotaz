import { Electroview } from "electrobun/view";
import type { DotazRPC } from "../../../shared/types/rpc";
import type { RpcTransport } from "./types";

const electroviewRpc = Electroview.defineRPC<DotazRPC>({
	handlers: {
		requests: {},
		messages: {},
	},
});

new Electroview({ rpc: electroviewRpc });

export const transport: RpcTransport = {
	call<T>(method: string, params: unknown): Promise<T> {
		return (electroviewRpc.request as any)[method](params);
	},
	addMessageListener(channel: string, handler: (payload: any) => void): () => void {
		electroviewRpc.addMessageListener(channel as any, handler as any);
		return () => {
			electroviewRpc.removeMessageListener(channel as any, handler as any);
		};
	},
};
