export interface RpcTransport {
	call<T>(method: string, params: unknown): Promise<T>;
	addMessageListener(channel: string, handler: (payload: any) => void): () => void;
}
