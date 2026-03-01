import type { RPCSchema } from "electrobun/bun";
import type { ConnectionState } from "./connection";
import type { RpcMethod, HandlerParams, HandlerReturn } from "../rpc/types";

// ---- Domain types used by handlers and adapters ----

export interface DataChange {
	type: "insert" | "update" | "delete";
	schema: string;
	table: string;
	/** Primary key values identifying the row (for update/delete) */
	primaryKeys?: Record<string, unknown>;
	/** Column values (for insert/update) */
	values?: Record<string, unknown>;
}

export interface HistoryListParams {
	connectionId?: string;
	limit?: number;
	offset?: number;
	search?: string;
}

export interface SavedViewConfig {
	columns?: string[];
	sort?: { column: string; direction: "asc" | "desc" }[];
	filters?: { column: string; operator: string; value: unknown }[];
	columnWidths?: Record<string, number>;
}

export interface SavedView {
	id: string;
	connectionId: string;
	schemaName: string;
	tableName: string;
	name: string;
	config: SavedViewConfig;
	createdAt: string;
	updatedAt: string;
}

export interface OpenDialogParams {
	title?: string;
	filters?: { name: string; extensions: string[] }[];
	multiple?: boolean;
}

export interface SaveDialogParams {
	title?: string;
	defaultName?: string;
	filters?: { name: string; extensions: string[] }[];
}

// ---- Main RPC schema (derived from handler map) ----

type DotazRequests = {
	[M in RpcMethod]: {
		params: HandlerParams<M> extends void ? {} : HandlerParams<M>;
		response: HandlerReturn<M>;
	};
};

export type DotazRPC = {
	bun: RPCSchema<{
		requests: DotazRequests;
		messages: {
			"connections.statusChanged": {
				connectionId: string;
				state: ConnectionState;
				error?: string;
			};
			"menu.action": {
				action: string;
			};
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
	}>;
};
