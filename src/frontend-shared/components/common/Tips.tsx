import { createSignal } from 'solid-js'
import Icon from './Icon'
import './Tips.css'

interface Tip {
	title: string
	description: string
}

const tips: Tip[] = [
	{
		title: 'Compare tables or queries',
		description:
			"Use the Compare feature to diff two tables or query results side-by-side. It highlights added, removed, and modified rows. Open it from the grid's More menu or the Command Palette.",
	},
	{
		title: 'Row detail side panel',
		description:
			'Double-click any row to open the detail panel on the right. You can edit fields, navigate FK references, and see which rows reference the current one.',
	},
	{
		title: 'Save and restore views',
		description:
			'Save your current sort rules, filters, column visibility, and column widths as a named view. Restore it anytime with a single click. Use Ctrl+S to quick-save updates to the active view.',
	},
	{
		title: 'Pin a session in SQL Console',
		description:
			'Pin a database session to keep the same connection alive across queries. Useful for temporary tables, session variables, or when working in a manual transaction.',
	},
	{
		title: 'Multi-column sorting',
		description:
			'Click a column header to sort by it. Hold Shift and click another column to add a secondary sort. You can stack as many sort levels as you need.',
	},
	{
		title: 'Batch edit multiple rows',
		description:
			'Select multiple rows, then use Batch Edit from the context menu. Set values, NULL, DEFAULT, current timestamp, or increment/decrement numeric columns — all at once.',
	},
	{
		title: 'Navigate foreign keys',
		description:
			'FK columns are clickable. Hover to peek at the referenced row, click to navigate to it in the detail panel, or use the FK Picker to browse and select a value from the referenced table.',
	},
	{
		title: 'Transpose the grid',
		description:
			'Toggle transposed view (Ctrl+Shift+T) to flip rows and columns. Great for tables with many columns or when you want to compare rows visually.',
	},
	{
		title: 'Quick cell value shortcuts',
		description:
			'When editing a cell, press N for NULL, D for DEFAULT, T/F for true/false (booleans). No need to type the full value — just press a single key on an empty cell.',
	},
	{
		title: 'Advanced copy with format options',
		description:
			'Beyond simple Ctrl+C, use Advanced Copy to export selected cells with a custom delimiter, quoted values, headers, row numbers, and a configurable NULL representation.',
	},
	{
		title: 'EXPLAIN & ANALYZE queries',
		description:
			'Press Ctrl+Shift+E in the SQL Console to see the query execution plan. EXPLAIN ANALYZE shows actual vs estimated costs and highlights expensive operations.',
	},
	{
		title: 'Bookmark frequently-used queries',
		description:
			'Press Ctrl+D in the SQL Console to bookmark the current query. Access your bookmarks anytime from the toolbar or Command Palette to quickly re-run saved SQL.',
	},
	{
		title: 'Command Palette',
		description:
			'Press Ctrl+Shift+P to open the Command Palette. Search for any action by name — it shows available commands with their keyboard shortcuts.',
	},
	{
		title: 'Tab Switcher',
		description:
			'Press Ctrl+E to open the Tab Switcher. Quickly search and jump between open tabs by name, or filter by type (Grid, SQL, Schema, Compare).',
	},
	{
		title: 'Custom SQL filter',
		description:
			"Beyond the built-in column filters, you can write a raw SQL WHERE clause as a custom filter. Useful for complex conditions that the UI filters can't express.",
	},
	{
		title: 'Pin columns left or right',
		description:
			'Pin important columns (like ID or name) to the left or right edge of the grid so they stay visible while scrolling horizontally through wide tables.',
	},
	{
		title: 'Paste tabular data',
		description:
			'Copy rows from a spreadsheet or CSV and paste them into the grid with Ctrl+V. Dotaz auto-detects the delimiter and shows a preview with column mapping before inserting.',
	},
	{
		title: 'Aggregate panel for selections',
		description:
			'Open the Aggregates side panel to see live statistics (count, sum, avg, min, max) for the selected cells. Select a range to instantly see computed metrics.',
	},
	{
		title: 'Export in multiple formats',
		description:
			'Export data as CSV, JSON, SQL INSERT, SQL UPDATE, Markdown, HTML, or XML. Choose to export all rows, the filtered view, or just the selected rows.',
	},
	{
		title: 'Transaction management',
		description:
			'Switch from auto-commit to manual transaction mode in the SQL Console. Use Ctrl+Shift+Enter to commit and Ctrl+Shift+R to rollback. The Transaction Log tracks all executed statements.',
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
			<div class="tips__header">
				<Icon name="info" size={14} class="tips__icon" />
				<span class="tips__label">Tip</span>
			</div>
			<div class="tips__content">
				<h3 class="tips__title">{tip().title}</h3>
				<p class="tips__description">{tip().description}</p>
			</div>
			<div class="tips__nav">
				<button class="tips__nav-btn" onClick={prev} title="Previous tip">
					<Icon name="chevron-left" size={14} />
				</button>
				<span class="tips__counter">{index() + 1} / {tips.length}</span>
				<button class="tips__nav-btn" onClick={next} title="Next tip">
					<Icon name="chevron-right" size={14} />
				</button>
			</div>
		</div>
	)
}
