import { Show } from "solid-js";
import "./StatusBar.css";

export type ConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

interface StatusBarProps {
	connectionName?: string;
	connectionStatus?: ConnectionStatus;
	schema?: string;
	rowCount?: number;
	inTransaction?: boolean;
}

function statusColor(status: ConnectionStatus): string {
	switch (status) {
		case "connected":
			return "var(--success)";
		case "connecting":
			return "var(--warning)";
		case "error":
			return "var(--error)";
		case "disconnected":
			return "var(--ink-muted)";
	}
}

export default function StatusBar(props: StatusBarProps) {
	return (
		<footer class="status-bar">
			<div class="status-bar__left">
				<Show when={props.connectionName} fallback={
					<span class="status-bar__item">No connection</span>
				}>
					<span class="status-bar__item">
						<span
							class="status-bar__dot"
							style={{ background: statusColor(props.connectionStatus ?? "disconnected") }}
						/>
						{props.connectionName}
					</span>
				</Show>

				<Show when={props.schema}>
					<span class="status-bar__separator" />
					<span class="status-bar__item">{props.schema}</span>
				</Show>
			</div>

			<div class="status-bar__right">
				<Show when={props.inTransaction}>
					<span class="status-bar__item status-bar__item--tx">IN TRANSACTION</span>
				</Show>

				<Show when={props.rowCount != null}>
					<span class="status-bar__item">
						{props.rowCount!.toLocaleString()} rows
					</span>
				</Show>
			</div>
		</footer>
	);
}
