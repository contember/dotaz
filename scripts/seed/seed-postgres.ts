/**
 * Seed a PostgreSQL demo database with bookstore data.
 *
 * Usage:
 *   bun scripts/seed/seed-postgres.ts [connection-string]
 *
 * Default: postgres://dotaz:dotaz@localhost:5488/bookstore_demo
 *
 * The script creates the database if it doesn't exist,
 * then populates it with the bookstore schema and data.
 */
import { generateAll } from "./generate-data";

const defaultUrl = "postgres://dotaz:dotaz@localhost:5488/bookstore_demo";
const targetUrl = process.argv[2] ?? defaultUrl;
const parsed = new URL(targetUrl);
const dbName = parsed.pathname.slice(1); // remove leading /

// ── ensure database exists ──────────────────────────────────────────────────

console.log(`Ensuring database "${dbName}" exists...`);

const adminUrl = new URL(parsed);
adminUrl.pathname = "/dotaz_test"; // connect to default db
const adminSql = new (await import("bun")).SQL(adminUrl.toString());

try {
	const exists = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
	if (exists.length === 0) {
		// Cannot use parameterized query for CREATE DATABASE
		await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
		console.log(`Created database "${dbName}".`);
	} else {
		console.log(`Database "${dbName}" already exists.`);
	}
} finally {
	await adminSql.close();
}

// ── connect to target database ──────────────────────────────────────────────

const sql = new (await import("bun")).SQL(targetUrl);

// Create schema
const schema = await Bun.file(new URL("./schema-postgres.sql", import.meta.url)).text();
await sql.unsafe(schema);
console.log("Schema created.");

// Generate data
const data = generateAll();
console.log("Inserting data...");

await sql.begin(async (tx) => {
	// authors
	for (const a of data.authors) {
		await tx`INSERT INTO author (id, first_name, last_name, bio, birth_year, country, website, created_at)
			VALUES (${a.id}, ${a.first_name}, ${a.last_name}, ${a.bio}, ${a.birth_year}, ${a.country}, ${a.website}, ${a.created_at})`;
	}

	// publishers
	for (const p of data.publishers) {
		await tx`INSERT INTO publisher (id, name, country, founded_year, website, email, created_at)
			VALUES (${p.id}, ${p.name}, ${p.country}, ${p.founded_year}, ${p.website}, ${p.email}, ${p.created_at})`;
	}

	// categories
	for (const c of data.categories) {
		await tx`INSERT INTO category (id, name, description, parent_id)
			VALUES (${c.id}, ${c.name}, ${c.description}, ${c.parent_id})`;
	}

	// books
	for (const b of data.books) {
		await tx`INSERT INTO book (id, title, isbn, author_id, publisher_id, publish_year, pages, price, stock_quantity, language, description, created_at)
			VALUES (${b.id}, ${b.title}, ${b.isbn}, ${b.author_id}, ${b.publisher_id}, ${b.publish_year}, ${b.pages}, ${b.price}, ${b.stock_quantity}, ${b.language}, ${b.description}, ${b.created_at})`;
	}

	// book_categories
	for (const bc of data.bookCategories) {
		await tx`INSERT INTO book_category (book_id, category_id) VALUES (${bc.book_id}, ${bc.category_id})`;
	}

	// customers
	for (const c of data.customers) {
		await tx`INSERT INTO customer (id, email, first_name, last_name, phone, registered_at, is_active)
			VALUES (${c.id}, ${c.email}, ${c.first_name}, ${c.last_name}, ${c.phone}, ${c.registered_at}, ${c.is_active})`;
	}

	// addresses
	for (const a of data.addresses) {
		await tx`INSERT INTO address (id, customer_id, label, street, city, state, postal_code, country, is_default)
			VALUES (${a.id}, ${a.customer_id}, ${a.label}, ${a.street}, ${a.city}, ${a.state}, ${a.postal_code}, ${a.country}, ${a.is_default})`;
	}

	// orders
	for (const o of data.orders) {
		await tx`INSERT INTO "order" (id, customer_id, address_id, status, total_amount, note, ordered_at, shipped_at)
			VALUES (${o.id}, ${o.customer_id}, ${o.address_id}, ${o.status}, ${o.total_amount}, ${o.note}, ${o.ordered_at}, ${o.shipped_at})`;
	}

	// order_items
	for (const oi of data.orderItems) {
		await tx`INSERT INTO order_item (id, order_id, book_id, quantity, unit_price)
			VALUES (${oi.id}, ${oi.order_id}, ${oi.book_id}, ${oi.quantity}, ${oi.unit_price})`;
	}

	// reviews
	for (const r of data.reviews) {
		await tx`INSERT INTO review (id, book_id, customer_id, rating, title, body, created_at)
			VALUES (${r.id}, ${r.book_id}, ${r.customer_id}, ${r.rating}, ${r.title}, ${r.body}, ${r.created_at})`;
	}

	// Reset sequences to max id
	await tx`SELECT setval('author_id_seq', (SELECT MAX(id) FROM author))`;
	await tx`SELECT setval('publisher_id_seq', (SELECT MAX(id) FROM publisher))`;
	await tx`SELECT setval('category_id_seq', (SELECT MAX(id) FROM category))`;
	await tx`SELECT setval('book_id_seq', (SELECT MAX(id) FROM book))`;
	await tx`SELECT setval('customer_id_seq', (SELECT MAX(id) FROM customer))`;
	await tx`SELECT setval('address_id_seq', (SELECT MAX(id) FROM address))`;
	await tx`SELECT setval('order_id_seq', (SELECT MAX(id) FROM "order"))`;
	await tx`SELECT setval('order_item_id_seq', (SELECT MAX(id) FROM order_item))`;
	await tx`SELECT setval('review_id_seq', (SELECT MAX(id) FROM review))`;
});

// Summary
const counts = [
	["author", data.authors.length],
	["publisher", data.publishers.length],
	["category", data.categories.length],
	["book", data.books.length],
	["book_category", data.bookCategories.length],
	["customer", data.customers.length],
	["address", data.addresses.length],
	["order", data.orders.length],
	["order_item", data.orderItems.length],
	["review", data.reviews.length],
] as const;

console.log("\nDone! Row counts:");
let total = 0;
for (const [table, count] of counts) {
	console.log(`  ${table.padEnd(16)} ${count}`);
	total += count;
}
console.log(`  ${"TOTAL".padEnd(16)} ${total}`);

await sql.close();
