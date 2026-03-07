import { createSignal, type JSX } from 'solid-js'
import type { IconName } from './Icon'
import Icon from './Icon'
import './Tips.css'

interface Tip {
	icon: IconName
	title: string
	description: () => JSX.Element
}

const Kbd = (props: { children: string }) => <kbd class="tips__kbd">{props.children}</kbd>

const tips: Tip[] = [
	{
		icon: 'compare',
		title: 'Compare tables or queries',
		description: () => (
			<>
				Diff two tables or query results <strong>side-by-side</strong>. Highlights added, removed, and modified rows. Open from the grid's{' '}
				<strong>More menu</strong> or the Command Palette.
			</>
		),
	},
	{
		icon: 'eye',
		title: 'Row detail side panel',
		description: () => (
			<>
				<strong>Double-click</strong> any row to open the detail panel. Edit fields, navigate FK references, and see which rows reference the current one.
			</>
		),
	},
	{
		icon: 'save',
		title: 'Save and restore views',
		description: () => (
			<>
				Save sort rules, filters, column visibility, and widths as a <strong>named view</strong>. Restore it anytime with one click. <Kbd>Ctrl+S</Kbd>
				{' '}
				quick-saves updates to the active view.
			</>
		),
	},
	{
		icon: 'pin',
		title: 'Pin a session in SQL Console',
		description: () => (
			<>
				Pin a database session to keep the <strong>same connection</strong>{' '}
				alive across queries. Useful for temporary tables, session variables, or manual transactions.
			</>
		),
	},
	{
		icon: 'sort-asc',
		title: 'Multi-column sorting',
		description: () => (
			<>
				Click a column header to sort. Hold <Kbd>Shift</Kbd> and click another column to add a{' '}
				<strong>secondary sort</strong>. Stack as many sort levels as you need.
			</>
		),
	},
	{
		icon: 'edit',
		title: 'Batch edit multiple rows',
		description: () => (
			<>
				Select rows, then use <strong>Batch Edit</strong>{' '}
				from the context menu. Set values, NULL, DEFAULT, current timestamp, or increment/decrement numeric columns — all at once.
			</>
		),
	},
	{
		icon: 'link',
		title: 'Navigate foreign keys',
		description: () => (
			<>
				FK columns are clickable — <strong>hover</strong> to peek at the referenced row, click to navigate, or use the <strong>FK Picker</strong>{' '}
				to browse and select a value.
			</>
		),
	},
	{
		icon: 'grid',
		title: 'Transpose the grid',
		description: () => (
			<>
				Press <Kbd>Ctrl+Shift+T</Kbd> to flip rows and columns. Great for <strong>wide tables</strong> or when you want to compare rows visually.
			</>
		),
	},
	{
		icon: 'key',
		title: 'Quick cell value shortcuts',
		description: () => (
			<>
				When editing a cell, press <Kbd>N</Kbd> for NULL, <Kbd>D</Kbd> for DEFAULT, <Kbd>T</Kbd>/<Kbd>F</Kbd> for true/false. Just press a{' '}
				<strong>single key</strong> on an empty cell.
			</>
		),
	},
	{
		icon: 'copy',
		title: 'Advanced copy with format options',
		description: () => (
			<>
				Beyond <Kbd>Ctrl+C</Kbd>, use <strong>Advanced Copy</strong>{' '}
				to export with a custom delimiter, quoted values, headers, row numbers, and configurable NULL representation.
			</>
		),
	},
	{
		icon: 'play',
		title: 'EXPLAIN & ANALYZE queries',
		description: () => (
			<>
				Press <Kbd>Ctrl+Shift+E</Kbd> to see the query execution plan. <strong>EXPLAIN ANALYZE</strong>{' '}
				shows actual vs estimated costs and highlights expensive operations.
			</>
		),
	},
	{
		icon: 'bookmark',
		title: 'Bookmark frequently-used queries',
		description: () => (
			<>
				Press <Kbd>Ctrl+D</Kbd> to bookmark the current query. Access bookmarks from the toolbar or <strong>Command Palette</strong>{' '}
				to quickly re-run saved SQL.
			</>
		),
	},
	{
		icon: 'command',
		title: 'Command Palette',
		description: () => (
			<>
				Press <Kbd>Ctrl+Shift+P</Kbd> to open the Command Palette. <strong>Search any action</strong>{' '}
				by name — it shows available commands with their keyboard shortcuts.
			</>
		),
	},
	{
		icon: 'search',
		title: 'Tab Switcher',
		description: () => (
			<>
				Press <Kbd>Ctrl+E</Kbd> to open the Tab Switcher. Quickly <strong>search and jump</strong>{' '}
				between open tabs by name, or filter by type (Grid, SQL, Schema, Compare).
			</>
		),
	},
	{
		icon: 'filter',
		title: 'Custom SQL filter',
		description: () => (
			<>
				Beyond built-in column filters, write a <strong>raw SQL WHERE clause</strong>{' '}
				as a custom filter. Useful for complex conditions the UI filters can't express.
			</>
		),
	},
	{
		icon: 'columns',
		title: 'Pin columns left or right',
		description: () => (
			<>
				Pin important columns (like ID or name) to the <strong>left or right edge</strong>{' '}
				so they stay visible while scrolling horizontally through wide tables.
			</>
		),
	},
	{
		icon: 'import',
		title: 'Paste tabular data',
		description: () => (
			<>
				Copy rows from a spreadsheet and paste with <Kbd>Ctrl+V</Kbd>. Dotaz <strong>auto-detects the delimiter</strong>{' '}
				and shows a preview with column mapping before inserting.
			</>
		),
	},
	{
		icon: 'info',
		title: 'Aggregate panel for selections',
		description: () => (
			<>
				Open the <strong>Aggregates</strong>{' '}
				side panel to see live statistics (count, sum, avg, min, max). Select a range to instantly see computed metrics.
			</>
		),
	},
	{
		icon: 'export',
		title: 'Export in multiple formats',
		description: () => (
			<>
				Export as{' '}
				<strong>CSV, JSON, SQL INSERT, SQL UPDATE, Markdown, HTML, or XML</strong>. Choose to export all rows, the filtered view, or just the selected
				rows.
			</>
		),
	},
	{
		icon: 'history',
		title: 'Transaction management',
		description: () => (
			<>
				Switch to <strong>manual transaction mode</strong> in the SQL Console. <Kbd>Ctrl+Shift+Enter</Kbd> to commit, <Kbd>Ctrl+Shift+R</Kbd>{' '}
				to rollback. The Transaction Log tracks all statements.
			</>
		),
	},
]

export default function Tips() {
	const [index, setIndex] = createSignal(Math.floor(Math.random() * tips.length))

	const tip = () => tips[index()]

	function next() {
		setIndex((i) => (i + 1) % tips.length)
	}

	function prev() {
		setIndex((i) => (i - 1 + tips.length) % tips.length)
	}

	return (
		<div class="tips">
			<button class="tips__nav-btn" onClick={prev} title="Previous tip">
				<Icon name="chevron-left" size={14} />
			</button>
			<div class="tips__content">
				<div class="tips__title-row">
					<Icon name={tip().icon} size={15} class="tips__tip-icon" />
					<h3 class="tips__title">{tip().title}</h3>
					<span class="tips__counter">{index() + 1}/{tips.length}</span>
				</div>
				<p class="tips__description">{tip().description()}</p>
			</div>
			<button class="tips__nav-btn" onClick={next} title="Next tip">
				<Icon name="chevron-right" size={14} />
			</button>
		</div>
	)
}
