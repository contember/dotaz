import type { JSX } from "solid-js";

export type IconName =
	| "database"
	| "table"
	| "view"
	| "schema"
	| "grid"
	| "sql-console"
	| "play"
	| "stop"
	| "refresh"
	| "plus"
	| "close"
	| "settings"
	| "filter"
	| "columns"
	| "export"
	| "search"
	| "copy"
	| "edit"
	| "delete"
	| "arrow-left"
	| "arrow-right"
	| "chevron-left"
	| "chevron-right"
	| "chevron-down"
	| "sort-asc"
	| "sort-desc"
	| "key"
	| "link"
	| "history"
	| "save"
	| "sidebar"
	| "command"
	| "pin"
	| "eye"
	| "eye-off"
	| "check"
	| "warning"
	| "error"
	| "info"
	| "spinner";

interface IconProps {
	name: IconName;
	size?: number;
	class?: string;
	style?: JSX.CSSProperties;
	title?: string;
}

/** SVG path data for each icon. All icons use a 16x16 viewBox. */
const ICON_PATHS: Record<IconName, string> = {
	database:
		"M8 1C4.13 1 1 2.34 1 4v8c0 1.66 3.13 3 7 3s7-1.34 7-3V4c0-1.66-3.13-3-7-3zm0 2c3.31 0 5 .9 5 1s-1.69 1-5 1S3 4.1 3 4s1.69-1 5-1zm0 11c-3.31 0-5-.9-5-1V6.5C4.36 7.36 6.04 7.82 8 7.82s3.64-.46 5-1.32V13c0 .1-1.69 1-5 1z",
	table:
		"M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM3.5 2a.5.5 0 0 0-.5.5V5h10V2.5a.5.5 0 0 0-.5-.5h-9zM3 6v3h4V6H3zm5 0v3h5V6H8zM3 10v3.5a.5.5 0 0 0 .5.5H7v-4H3zm5 0v4h4.5a.5.5 0 0 0 .5-.5V10H8z",
	view:
		"M8 3C3.58 3 0 8 0 8s3.58 5 8 5 8-5 8-5-3.58-5-8-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
	schema:
		"M2 3.5A1.5 1.5 0 0 1 3.5 2h4A1.5 1.5 0 0 1 9 3.5V5h2.5A1.5 1.5 0 0 1 13 6.5v3A1.5 1.5 0 0 1 11.5 11H9v1.5A1.5 1.5 0 0 1 7.5 14h-4A1.5 1.5 0 0 1 2 12.5v-9zM3.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5V11H8V6.5A1.5 1.5 0 0 1 9.5 5H8V3.5a.5.5 0 0 0-.5-.5h-4zm6 3a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-2z",
	grid:
		"M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V5h5V3H2.5zM9 3v2h5V3.5a.5.5 0 0 0-.5-.5H9zM2 6v3h5V6H2zm7 0v3h5V6H9zM2 10v2.5a.5.5 0 0 0 .5.5H7v-3H2zm7 0v3h4.5a.5.5 0 0 0 .5-.5V10H9z",
	"sql-console":
		"M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM4 5l3 3-3 3 1 1 4-4-4-4-1 1zm4 6h4v1H8v-1z",
	play:
		"M4 2.5v11l9-5.5L4 2.5z",
	stop:
		"M3 3h10v10H3V3z",
	refresh:
		"M13.5 8c0 3.04-2.46 5.5-5.5 5.5a5.5 5.5 0 0 1-4.73-2.7l1.27-.73A4 4 0 0 0 8 12c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 0 0-3.2 1.6L6 7H1V2l1.8 1.8A5.48 5.48 0 0 1 8 2.5c3.04 0 5.5 2.46 5.5 5.5z",
	plus:
		"M8 2v12M2 8h12",
	close:
		"M4 4l8 8M12 4l-8 8",
	settings:
		"M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm5.66-1.34l1.06.61a.5.5 0 0 1 .18.68l-1 1.73a.5.5 0 0 1-.68.18l-1.06-.61a4.5 4.5 0 0 1-1.16.67V13a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5v-1.08a4.5 4.5 0 0 1-1.16-.67l-1.06.61a.5.5 0 0 1-.68-.18l-1-1.73a.5.5 0 0 1 .18-.68l1.06-.61a4.5 4.5 0 0 1 0-1.32l-1.06-.61a.5.5 0 0 1-.18-.68l1-1.73a.5.5 0 0 1 .68-.18l1.06.61A4.5 4.5 0 0 1 6 4.08V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.08c.42.17.81.39 1.16.67l1.06-.61a.5.5 0 0 1 .68.18l1 1.73a.5.5 0 0 1-.18.68l-1.06.61a4.5 4.5 0 0 1 0 1.32z",
	filter:
		"M1 2h14l-5.5 6.5V13l-3 2V8.5L1 2z",
	columns:
		"M3 2h3v12H3V2zm3.5 0h3v12h-3V2zm3.5 0h3v12h-3V2z",
	export:
		"M8 1v9m0 0L5 7m3 3l3-3M2 12v1.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V12",
	search:
		"M6.5 1a5.5 5.5 0 0 1 4.38 8.82l3.65 3.65-.71.71-3.65-3.65A5.5 5.5 0 1 1 6.5 1zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
	copy:
		"M5 1h6.5A1.5 1.5 0 0 1 13 2.5V11h-1V2.5a.5.5 0 0 0-.5-.5H5V1zm-2 3a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 3 15h6a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 9 4H3zm0 1.5h6v8H3v-8z",
	edit:
		"M11.5 1.5l3 3-9 9H2.5v-3l9-9zm-1 2l1 1-7 7H3.5V10.5l7-7z",
	delete:
		"M5.5 2V1h5v1h4v1h-1v10.5a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13.5V3h-1V2h4zm-2 1v10.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V3h-9zM6 5v7h1V5H6zm3 0v7h1V5H9z",
	"arrow-left":
		"M10 3L5 8l5 5",
	"arrow-right":
		"M6 3l5 5-5 5",
	"chevron-left":
		"M10 3L5 8l5 5",
	"chevron-right":
		"M6 3l5 5-5 5",
	"chevron-down":
		"M3 6l5 5 5-5",
	"sort-asc":
		"M8 2v12M4 6l4-4 4 4",
	"sort-desc":
		"M8 2v12M4 10l4 4 4-4",
	key:
		"M8 1a4 4 0 0 0-3.87 5.03L1 9.17V13h3v-2h2v-2h1.83l.3-.3A4 4 0 0 0 8 1zm1 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z",
	link:
		"M7 4H5.5A3.5 3.5 0 0 0 2 7.5v1A3.5 3.5 0 0 0 5.5 12H7v-1.5H5.5A2 2 0 0 1 3.5 8.5v-1A2 2 0 0 1 5.5 5.5H7V4zm2 0v1.5h1.5A2 2 0 0 1 12.5 7.5v1a2 2 0 0 1-2 2H9V12h1.5a3.5 3.5 0 0 0 3.5-3.5v-1A3.5 3.5 0 0 0 10.5 4H9zM5 8h6v1H5V8z",
	history:
		"M8 1a7 7 0 1 0 7 7h-1.5A5.5 5.5 0 1 1 8 2.5V5l3-2.5L8 0v1zm-.5 3v4.5l3 1.8.75-1.3-2.25-1.35V4h-1.5z",
	save:
		"M2 2.5A1.5 1.5 0 0 1 3.5 1h8.59a1.5 1.5 0 0 1 1.06.44l1.41 1.41a1.5 1.5 0 0 1 .44 1.06V13.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 2 13.5v-11zM5 2v3h6V2H5zm3 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
	sidebar:
		"M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H6V2H3.5zM7 2v12h5.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H7z",
	command:
		"M3.5 2A1.5 1.5 0 0 0 2 3.5V5h3V2H3.5zM6 2v3h4V2H6zm5 0v3h3V3.5A1.5 1.5 0 0 0 12.5 2H11zM14 6h-3v4h3V6zM2 6v4h3V6H2zm4 0v4h4V6H6zm5 5v3h1.5a1.5 1.5 0 0 0 1.5-1.5V11h-3zM2 11v1.5A1.5 1.5 0 0 0 3.5 14H5v-3H2zm4 0v3h4v-3H6z",
	pin:
		"M9.83 1.87L14.13 6.17L12.72 7.59L12.02 6.89L9 9.91V12.5L8 13.5L6.09 10.41L3.21 13.29L2.5 12.59L5.38 9.71L2.5 8L3.5 7H6.09L9.11 3.98L8.41 3.28L9.83 1.87z",
	eye:
		"M8 3C3.58 3 0 8 0 8s3.58 5 8 5 8-5 8-5-3.58-5-8-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
	"eye-off":
		"M2.5 2L14 13.5l-.71.71L11.27 12.19A7.6 7.6 0 0 1 8 13C3.58 13 0 8 0 8s1.45-2.03 3.73-3.56L1.79 2.5 2.5 2zM8 5c.36 0 .71.06 1.04.18L5.18 9.04A3 3 0 0 1 8 5zm0-2c4.42 0 8 5 8 5s-.86 1.2-2.28 2.44l-.72-.72c.98-.89 1.72-1.72 1.72-1.72S12.42 5 8 5c-.53 0-1.04.07-1.53.18l-.87-.87A8.7 8.7 0 0 1 8 3z",
	check:
		"M3 8l3.5 3.5L13 5",
	warning:
		"M8 1l7 13H1L8 1zm0 4v4h0V5zm0 6a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z",
	error:
		"M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7.25 4.5h1.5v5h-1.5v-5zM8 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2z",
	info:
		"M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7.25 5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zM7 7h2v4.5H7V7z",
	spinner: "", // Spinner is rendered specially
};

/** Uses stroke-based rendering (for path-only icons like plus, close, arrows) */
const STROKE_ICONS = new Set<IconName>([
	"plus",
	"close",
	"arrow-left",
	"arrow-right",
	"chevron-left",
	"chevron-right",
	"chevron-down",
	"sort-asc",
	"sort-desc",
	"check",
	"export",
]);

export default function Icon(props: IconProps) {
	const size = () => props.size ?? 16;

	if (props.name === "spinner") {
		return (
			<span
				class={`spinner${props.class ? ` ${props.class}` : ""}`}
				style={{
					width: `${size()}px`,
					height: `${size()}px`,
					...(props.style ?? {}),
				}}
				title={props.title}
			/>
		);
	}

	const isStroke = STROKE_ICONS.has(props.name);

	return (
		<svg
			width={size()}
			height={size()}
			viewBox="0 0 16 16"
			fill={isStroke ? "none" : "currentColor"}
			stroke={isStroke ? "currentColor" : "none"}
			stroke-width={isStroke ? "1.5" : undefined}
			stroke-linecap={isStroke ? "round" : undefined}
			stroke-linejoin={isStroke ? "round" : undefined}
			class={props.class}
			style={props.style}
			aria-hidden={!props.title}
			role={props.title ? "img" : undefined}
		>
			{props.title && <title>{props.title}</title>}
			<path d={ICON_PATHS[props.name]} />
		</svg>
	);
}
