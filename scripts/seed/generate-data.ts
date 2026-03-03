/**
 * Shared data generator for the demo "Bookstore" database.
 * Produces deterministic data using faker with a fixed seed.
 */
import { faker } from '@faker-js/faker'

faker.seed(42)

// ── helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
	return arr[faker.number.int({ min: 0, max: arr.length - 1 })]
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
	const n = faker.number.int({ min, max: Math.min(max, arr.length) })
	const shuffled = [...arr].sort(() => faker.number.float() - 0.5)
	return shuffled.slice(0, n)
}

function dateStr(from: string, to: string): string {
	return faker.date.between({ from, to }).toISOString().slice(0, 19).replace('T', ' ')
}

function money(min: number, max: number): number {
	return Math.round(faker.number.float({ min, max }) * 100) / 100
}

// ── row types ────────────────────────────────────────────────────────────────

export interface Author {
	id: number
	first_name: string
	last_name: string
	bio: string
	birth_year: number
	country: string
	website: string | null
	created_at: string
}

export interface Publisher {
	id: number
	name: string
	country: string
	founded_year: number
	website: string
	email: string
	created_at: string
}

export interface Category {
	id: number
	name: string
	description: string
	parent_id: number | null
}

export interface Book {
	id: number
	title: string
	isbn: string
	author_id: number
	publisher_id: number
	publish_year: number
	pages: number
	price: number
	stock_quantity: number
	language: string
	description: string
	created_at: string
}

export interface BookCategory {
	book_id: number
	category_id: number
}

export interface Customer {
	id: number
	email: string
	first_name: string
	last_name: string
	phone: string | null
	registered_at: string
	is_active: boolean
}

export interface Address {
	id: number
	customer_id: number
	label: string
	street: string
	city: string
	state: string | null
	postal_code: string
	country: string
	is_default: boolean
}

export interface Order {
	id: number
	customer_id: number
	address_id: number
	status: string
	total_amount: number
	note: string | null
	ordered_at: string
	shipped_at: string | null
}

export interface OrderItem {
	id: number
	order_id: number
	book_id: number
	quantity: number
	unit_price: number
}

export interface Review {
	id: number
	book_id: number
	customer_id: number
	rating: number
	title: string
	body: string | null
	created_at: string
}

// ── counts ───────────────────────────────────────────────────────────────────

const AUTHOR_COUNT = 60
const PUBLISHER_COUNT = 25
const CATEGORY_COUNT = 15
const BOOK_COUNT = 500
const CUSTOMER_COUNT = 1000
const ORDER_COUNT = 3000
const REVIEW_COUNT = 2000

// ── generators ───────────────────────────────────────────────────────────────

function generateAuthors(): Author[] {
	return Array.from({ length: AUTHOR_COUNT }, (_, i) => ({
		id: i + 1,
		first_name: faker.person.firstName(),
		last_name: faker.person.lastName(),
		bio: faker.lorem.sentences({ min: 2, max: 4 }),
		birth_year: faker.number.int({ min: 1920, max: 1995 }),
		country: faker.location.country(),
		website: faker.datatype.boolean(0.6) ? faker.internet.url() : null,
		created_at: dateStr('2020-01-01', '2024-06-01'),
	}))
}

function generatePublishers(): Publisher[] {
	return Array.from({ length: PUBLISHER_COUNT }, (_, i) => ({
		id: i + 1,
		name: faker.company.name() + ' Publishing',
		country: faker.location.country(),
		founded_year: faker.number.int({ min: 1850, max: 2015 }),
		website: faker.internet.url(),
		email: faker.internet.email(),
		created_at: dateStr('2020-01-01', '2023-01-01'),
	}))
}

function generateCategories(): Category[] {
	const names = [
		'Fiction',
		'Non-Fiction',
		'Science Fiction',
		'Fantasy',
		'Mystery',
		'Thriller',
		'Romance',
		'Biography',
		'History',
		'Science',
		'Technology',
		'Philosophy',
		'Poetry',
		'Children',
		'Self-Help',
	]
	// First two are top-level, rest have a parent
	return names.map((name, i) => ({
		id: i + 1,
		name,
		description: faker.lorem.sentence(),
		parent_id: i < 2 ? null : (i < 7 ? 1 : 2), // Fiction children vs Non-Fiction children
	}))
}

const LANGUAGES = ['English', 'Czech', 'German', 'French', 'Spanish']
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']

function generateBooks(authors: Author[], publishers: Publisher[]): Book[] {
	return Array.from({ length: BOOK_COUNT }, (_, i) => ({
		id: i + 1,
		title: faker.lorem.words({ min: 1, max: 5 }).replace(/^\w/, (c) => c.toUpperCase()),
		isbn: faker.string.numeric(13),
		author_id: pick(authors).id,
		publisher_id: pick(publishers).id,
		publish_year: faker.number.int({ min: 1960, max: 2024 }),
		pages: faker.number.int({ min: 80, max: 1200 }),
		price: money(4.99, 59.99),
		stock_quantity: faker.number.int({ min: 0, max: 500 }),
		language: pick(LANGUAGES),
		description: faker.lorem.paragraph(),
		created_at: dateStr('2020-01-01', '2024-12-01'),
	}))
}

function generateBookCategories(books: Book[], categories: Category[]): BookCategory[] {
	const set = new Set<string>()
	const rows: BookCategory[] = []
	for (const book of books) {
		const cats = pickN(categories, 1, 3)
		for (const cat of cats) {
			const key = `${book.id}-${cat.id}`
			if (!set.has(key)) {
				set.add(key)
				rows.push({ book_id: book.id, category_id: cat.id })
			}
		}
	}
	return rows
}

function generateCustomers(): Customer[] {
	return Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
		const first = faker.person.firstName()
		const last = faker.person.lastName()
		return {
			id: i + 1,
			email: faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
			first_name: first,
			last_name: last,
			phone: faker.datatype.boolean(0.7) ? faker.phone.number() : null,
			registered_at: dateStr('2020-01-01', '2024-12-01'),
			is_active: faker.datatype.boolean(0.9),
		}
	})
}

function generateAddresses(customers: Customer[]): Address[] {
	const rows: Address[] = []
	let id = 1
	for (const c of customers) {
		const count = faker.number.int({ min: 1, max: 3 })
		const labels = ['Home', 'Work', 'Other']
		for (let j = 0; j < count; j++) {
			rows.push({
				id: id++,
				customer_id: c.id,
				label: labels[j],
				street: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.datatype.boolean(0.6) ? faker.location.state() : null,
				postal_code: faker.location.zipCode(),
				country: faker.location.country(),
				is_default: j === 0,
			})
		}
	}
	return rows
}

function generateOrders(customers: Customer[], addresses: Address[]): Order[] {
	// Index addresses by customer for fast lookup
	const addrByCustomer = new Map<number, Address[]>()
	for (const a of addresses) {
		const list = addrByCustomer.get(a.customer_id) ?? []
		list.push(a)
		addrByCustomer.set(a.customer_id, list)
	}

	return Array.from({ length: ORDER_COUNT }, (_, i) => {
		const customer = pick(customers)
		const customerAddrs = addrByCustomer.get(customer.id) ?? []
		const address = customerAddrs.length > 0 ? pick(customerAddrs) : pick(addresses)
		const status = pick(ORDER_STATUSES)
		const orderedAt = dateStr('2021-01-01', '2024-12-01')
		return {
			id: i + 1,
			customer_id: customer.id,
			address_id: address.id,
			status,
			total_amount: 0, // will be calculated after order_items
			note: faker.datatype.boolean(0.2) ? faker.lorem.sentence() : null,
			ordered_at: orderedAt,
			shipped_at: ['shipped', 'delivered'].includes(status)
				? dateStr(orderedAt, '2025-01-01')
				: null,
		}
	})
}

function generateOrderItems(orders: Order[], books: Book[]): OrderItem[] {
	const rows: OrderItem[] = []
	let id = 1
	for (const order of orders) {
		const itemCount = faker.number.int({ min: 1, max: 5 })
		const pickedBooks = pickN(books, itemCount, itemCount)
		let total = 0
		for (const book of pickedBooks) {
			const qty = faker.number.int({ min: 1, max: 3 })
			const unitPrice = book.price
			total += qty * unitPrice
			rows.push({
				id: id++,
				order_id: order.id,
				book_id: book.id,
				quantity: qty,
				unit_price: unitPrice,
			})
		}
		order.total_amount = Math.round(total * 100) / 100
	}
	return rows
}

function generateReviews(books: Book[], customers: Customer[]): Review[] {
	const set = new Set<string>()
	const rows: Review[] = []
	let id = 1
	while (rows.length < REVIEW_COUNT) {
		const book = pick(books)
		const customer = pick(customers)
		const key = `${book.id}-${customer.id}`
		if (set.has(key)) continue
		set.add(key)
		rows.push({
			id: id++,
			book_id: book.id,
			customer_id: customer.id,
			rating: faker.number.int({ min: 1, max: 5 }),
			title: faker.lorem.words({ min: 2, max: 6 }),
			body: faker.datatype.boolean(0.7) ? faker.lorem.paragraph() : null,
			created_at: dateStr('2021-06-01', '2025-01-01'),
		})
	}
	return rows
}

// ── public API ───────────────────────────────────────────────────────────────

export interface DemoData {
	authors: Author[]
	publishers: Publisher[]
	categories: Category[]
	books: Book[]
	bookCategories: BookCategory[]
	customers: Customer[]
	addresses: Address[]
	orders: Order[]
	orderItems: OrderItem[]
	reviews: Review[]
}

export function generateAll(): DemoData {
	// Reset seed so we always get the same data
	faker.seed(42)

	const authors = generateAuthors()
	const publishers = generatePublishers()
	const categories = generateCategories()
	const books = generateBooks(authors, publishers)
	const bookCategories = generateBookCategories(books, categories)
	const customers = generateCustomers()
	const addresses = generateAddresses(customers)
	const orders = generateOrders(customers, addresses)
	const orderItems = generateOrderItems(orders, books)
	const reviews = generateReviews(books, customers)

	return {
		authors,
		publishers,
		categories,
		books,
		bookCategories,
		customers,
		addresses,
		orders,
		orderItems,
		reviews,
	}
}
