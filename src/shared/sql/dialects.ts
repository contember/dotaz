import type { ConnectionType } from '../types/connection'
import type { SqlDialect } from './dialect'

// ANSI/standard double-quote identifier quoting (Postgres, SQLite, and the
// dialect-less export fallback). MySQL uses backticks — see MysqlDialect.
export function ansiQuoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`
}

export class PostgresDialect implements SqlDialect {
	quoteIdentifier(name: string): string {
		return ansiQuoteIdentifier(name)
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`
	}

	getDriverType(): ConnectionType {
		return 'postgresql'
	}

	placeholder(index: number): string {
		return `$${index}`
	}
}

export class SqliteDialect implements SqlDialect {
	quoteIdentifier(name: string): string {
		return ansiQuoteIdentifier(name)
	}

	qualifyTable(schema: string, table: string): string {
		if (schema === 'main') return this.quoteIdentifier(table)
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`
	}

	getDriverType(): ConnectionType {
		return 'sqlite'
	}

	placeholder(index: number): string {
		return `$${index}`
	}
}

export class MysqlDialect implements SqlDialect {
	quoteIdentifier(name: string): string {
		return `\`${name.replace(/`/g, '``')}\``
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} () VALUES ()`
	}

	getDriverType(): ConnectionType {
		return 'mysql'
	}

	placeholder(_index: number): string {
		return '?'
	}
}
