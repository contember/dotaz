import type { createHandlers } from "./handlers";

/** The full handler map returned by createHandlers(). */
export type HandlerMap = ReturnType<typeof createHandlers>;

/** All RPC method names (e.g. "connections.list", "query.execute"). */
export type RpcMethod = keyof HandlerMap;

/** Extract the params type for a given RPC method. */
export type HandlerParams<M extends RpcMethod> =
	Parameters<HandlerMap[M]> extends [infer P] ? P : void;

/** Extract the return type for a given RPC method. */
export type HandlerReturn<M extends RpcMethod> =
	Awaited<ReturnType<HandlerMap[M]>>;

// ── Namespace grouping ──────────────────────────────────

/** Extract the namespace portion from a dotted key (e.g. "connections" from "connections.list"). */
type Namespace<K extends string> = K extends `${infer NS}.${string}` ? NS : never;

/** Extract the method portion from a dotted key (e.g. "list" from "connections.list"). */
type MethodName<K extends string> = K extends `${string}.${infer M}` ? M : never;

/** All namespace names. */
type Namespaces = Namespace<RpcMethod & string>;

/** All method keys belonging to a given namespace. */
type MethodsOf<NS extends string> = Extract<RpcMethod, `${NS}.${string}`>;

/** Build a typed client method for a given handler key. */
type ClientMethod<M extends RpcMethod> =
	Parameters<HandlerMap[M]> extends [infer P]
		? (params: P) => Promise<HandlerReturn<M>>
		: () => Promise<HandlerReturn<M>>;

/**
 * A namespaced RPC client derived from the handler map.
 *
 * Usage:
 *   rpc.connections.list()          // () => Promise<ConnectionInfo[]>
 *   rpc.query.execute({ ... })      // (params: ExecuteQueryParams) => Promise<QueryResult[]>
 */
export type NamespacedRpcClient = {
	[NS in Namespaces]: {
		[M in MethodsOf<NS> as MethodName<M & string>]: ClientMethod<M>;
	};
};
