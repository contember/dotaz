export interface RpcTransport {
	call<T>(method: string, params: unknown): Promise<T>
	addMessageListener<T = unknown>(channel: string, handler: (payload: T) => void): () => void
}
