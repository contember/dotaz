/**
 * Seed a SQLite demo database with bookstore data.
 *
 * Usage:
 *   bun scripts/seed/seed-sqlite.ts [path]
 *
 * Default path: scripts/seed/bookstore.db
 */
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { generateAll } from './generate-data'

const dbPath = process.argv[2] ?? 'scripts/seed/bookstore.db'
console.log(`Seeding SQLite database: ${dbPath}`)

const db = new Database(dbPath, { create: true })
db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')

// Create schema
const schema = readFileSync(new URL('./schema-sqlite.sql', import.meta.url), 'utf-8')
db.exec(schema)

// Generate data
const data = generateAll()

console.log('Inserting data...')

db.exec('BEGIN')

// authors
const insertAuthor = db.prepare(
	`INSERT INTO author (id, first_name, last_name, bio, birth_year, country, website, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)
for (const a of data.authors) {
	insertAuthor.run(a.id, a.first_name, a.last_name, a.bio, a.birth_year, a.country, a.website, a.created_at)
}

// publishers
const insertPublisher = db.prepare(
	`INSERT INTO publisher (id, name, country, founded_year, website, email, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
for (const p of data.publishers) {
	insertPublisher.run(p.id, p.name, p.country, p.founded_year, p.website, p.email, p.created_at)
}

// categories
const insertCategory = db.prepare(
	`INSERT INTO category (id, name, description, parent_id) VALUES (?, ?, ?, ?)`,
)
for (const c of data.categories) {
	insertCategory.run(c.id, c.name, c.description, c.parent_id)
}

// books
const insertBook = db.prepare(
	`INSERT INTO book (id, title, isbn, author_id, publisher_id, publish_year, pages, price, stock_quantity, language, description, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
for (const b of data.books) {
	insertBook.run(
		b.id,
		b.title,
		b.isbn,
		b.author_id,
		b.publisher_id,
		b.publish_year,
		b.pages,
		b.price,
		b.stock_quantity,
		b.language,
		b.description,
		b.created_at,
	)
}

// book_categories
const insertBC = db.prepare(
	`INSERT INTO book_category (book_id, category_id) VALUES (?, ?)`,
)
for (const bc of data.bookCategories) {
	insertBC.run(bc.book_id, bc.category_id)
}

// customers
const insertCustomer = db.prepare(
	`INSERT INTO customer (id, email, first_name, last_name, phone, registered_at, is_active)
	 VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
for (const c of data.customers) {
	insertCustomer.run(c.id, c.email, c.first_name, c.last_name, c.phone, c.registered_at, c.is_active ? 1 : 0)
}

// addresses
const insertAddress = db.prepare(
	`INSERT INTO address (id, customer_id, label, street, city, state, postal_code, country, is_default)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
for (const a of data.addresses) {
	insertAddress.run(a.id, a.customer_id, a.label, a.street, a.city, a.state, a.postal_code, a.country, a.is_default ? 1 : 0)
}

// orders
const insertOrder = db.prepare(
	`INSERT INTO "order" (id, customer_id, address_id, status, total_amount, note, ordered_at, shipped_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)
for (const o of data.orders) {
	insertOrder.run(o.id, o.customer_id, o.address_id, o.status, o.total_amount, o.note, o.ordered_at, o.shipped_at)
}

// order_items
const insertItem = db.prepare(
	`INSERT INTO order_item (id, order_id, book_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`,
)
for (const oi of data.orderItems) {
	insertItem.run(oi.id, oi.order_id, oi.book_id, oi.quantity, oi.unit_price)
}

// reviews
const insertReview = db.prepare(
	`INSERT INTO review (id, book_id, customer_id, rating, title, body, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
for (const r of data.reviews) {
	insertReview.run(r.id, r.book_id, r.customer_id, r.rating, r.title, r.body, r.created_at)
}

db.exec('COMMIT')

// Summary
const counts = [
	['author', data.authors.length],
	['publisher', data.publishers.length],
	['category', data.categories.length],
	['book', data.books.length],
	['book_category', data.bookCategories.length],
	['customer', data.customers.length],
	['address', data.addresses.length],
	['order', data.orders.length],
	['order_item', data.orderItems.length],
	['review', data.reviews.length],
] as const

console.log('\nDone! Row counts:')
let total = 0
for (const [table, count] of counts) {
	console.log(`  ${table.padEnd(16)} ${count}`)
	total += count
}
console.log(`  ${'TOTAL'.padEnd(16)} ${total}`)
console.log(`\nDatabase saved to: ${dbPath}`)

// Checkpoint WAL to consolidate into main database file
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
