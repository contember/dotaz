import { getDataTypeLabel } from '@dotaz/shared/column-types'
import type { ColumnInfo, ForeignKeyInfo, SchemaData } from '@dotaz/shared/types/database'
import type { ResolvedTable } from './sql-navigation'

const MAX_COLUMNS_SHOWN = 30

/**
 * Build a DOM tree for a table's quick-doc popover. Used by the editor
 * hover tooltip — kept transport-agnostic so it could be reused elsewhere
 * (sidebar hover, command palette preview, etc.).
 */
export function renderTableQuickDoc(
	resolved: ResolvedTable,
	schemaData: SchemaData,
): HTMLElement {
	const root = document.createElement('div')
	root.className = 'sql-quick-doc'

	const header = document.createElement('div')
	header.className = 'sql-quick-doc__header'
	const typeBadge = document.createElement('span')
	typeBadge.className = 'sql-quick-doc__type-badge'
	typeBadge.textContent = resolved.type === 'materialized-view' ? 'MAT VIEW' : resolved.type.toUpperCase()
	header.appendChild(typeBadge)
	const title = document.createElement('span')
	title.className = 'sql-quick-doc__title'
	title.textContent = `${resolved.schema}.${resolved.table}`
	header.appendChild(title)
	root.appendChild(header)

	const key = `${resolved.schema}.${resolved.table}`
	const columns = schemaData.columns[key] ?? []
	const fks = schemaData.foreignKeys[key] ?? []
	const fkByColumn = new Map<string, ForeignKeyInfo>()
	for (const fk of fks) {
		if (fk.columns.length === 1) fkByColumn.set(fk.columns[0], fk)
	}

	const list = document.createElement('div')
	list.className = 'sql-quick-doc__columns'

	const shown = columns.slice(0, MAX_COLUMNS_SHOWN)
	for (const col of shown) {
		list.appendChild(renderColumnRow(col, fkByColumn.get(col.name)))
	}
	if (columns.length > shown.length) {
		const more = document.createElement('div')
		more.className = 'sql-quick-doc__more'
		more.textContent = `… +${columns.length - shown.length} more columns`
		list.appendChild(more)
	}
	root.appendChild(list)

	if (fks.length > 0) {
		const fkSection = document.createElement('div')
		fkSection.className = 'sql-quick-doc__fks'
		const label = document.createElement('div')
		label.className = 'sql-quick-doc__section-label'
		label.textContent = `Foreign keys (${fks.length})`
		fkSection.appendChild(label)
		for (const fk of fks) {
			const row = document.createElement('div')
			row.className = 'sql-quick-doc__fk-row'
			row.textContent = `${fk.columns.join(', ')} → ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns.join(', ')}`
			fkSection.appendChild(row)
		}
		root.appendChild(fkSection)
	}

	return root
}

/**
 * Quick-doc for a single column when the hover lands on `table.column` syntax.
 */
export function renderColumnQuickDoc(
	resolved: ResolvedTable,
	columnName: string,
	schemaData: SchemaData,
): HTMLElement | null {
	const key = `${resolved.schema}.${resolved.table}`
	const columns = schemaData.columns[key] ?? []
	const col = columns.find((c) => c.name === columnName)
		?? columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase())
	if (!col) return null

	const fks = schemaData.foreignKeys[key] ?? []
	const fk = fks.find((f) => f.columns.length === 1 && f.columns[0] === col.name)

	const root = document.createElement('div')
	root.className = 'sql-quick-doc'

	const header = document.createElement('div')
	header.className = 'sql-quick-doc__header'
	const title = document.createElement('span')
	title.className = 'sql-quick-doc__title'
	title.textContent = `${resolved.schema}.${resolved.table}.${col.name}`
	header.appendChild(title)
	root.appendChild(header)

	const list = document.createElement('div')
	list.className = 'sql-quick-doc__columns'
	list.appendChild(renderColumnRow(col, fk))
	root.appendChild(list)

	if (col.defaultValue) {
		const def = document.createElement('div')
		def.className = 'sql-quick-doc__default'
		def.textContent = `Default: ${col.defaultValue}`
		root.appendChild(def)
	}

	return root
}

function renderColumnRow(col: ColumnInfo, fk: ForeignKeyInfo | undefined): HTMLElement {
	const row = document.createElement('div')
	row.className = 'sql-quick-doc__col-row'

	const name = document.createElement('span')
	name.className = 'sql-quick-doc__col-name'
	if (col.isPrimaryKey) name.classList.add('sql-quick-doc__col-name--pk')
	name.textContent = col.name
	row.appendChild(name)

	const type = document.createElement('span')
	type.className = 'sql-quick-doc__col-type'
	type.textContent = getDataTypeLabel(col.dataType) + (col.nullable ? '' : ' NOT NULL')
	row.appendChild(type)

	if (col.isPrimaryKey) {
		const pk = document.createElement('span')
		pk.className = 'sql-quick-doc__col-flag sql-quick-doc__col-flag--pk'
		pk.textContent = 'PK'
		row.appendChild(pk)
	}
	if (fk) {
		const fkBadge = document.createElement('span')
		fkBadge.className = 'sql-quick-doc__col-flag sql-quick-doc__col-flag--fk'
		fkBadge.textContent = `→ ${fk.referencedTable}`
		fkBadge.title = `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns.join(', ')}`
		row.appendChild(fkBadge)
	}

	return row
}
