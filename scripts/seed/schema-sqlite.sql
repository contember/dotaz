-- Bookstore demo schema for SQLite

DROP TABLE IF EXISTS review;
DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS "order";
DROP TABLE IF EXISTS address;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS book_category;
DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS publisher;
DROP TABLE IF EXISTS author;

CREATE TABLE author (
    id          INTEGER PRIMARY KEY,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    bio         TEXT,
    birth_year  INTEGER,
    country     TEXT,
    website     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE publisher (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    country      TEXT,
    founded_year INTEGER,
    website      TEXT,
    email        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE category (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id   INTEGER REFERENCES category(id)
);

CREATE TABLE book (
    id             INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    isbn           TEXT NOT NULL UNIQUE,
    author_id      INTEGER NOT NULL REFERENCES author(id),
    publisher_id   INTEGER NOT NULL REFERENCES publisher(id),
    publish_year   INTEGER,
    pages          INTEGER,
    price          REAL NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    language       TEXT NOT NULL DEFAULT 'English',
    description    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE book_category (
    book_id     INTEGER NOT NULL REFERENCES book(id),
    category_id INTEGER NOT NULL REFERENCES category(id),
    PRIMARY KEY (book_id, category_id)
);

CREATE TABLE customer (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    phone         TEXT,
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE address (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customer(id),
    label       TEXT NOT NULL,
    street      TEXT NOT NULL,
    city        TEXT NOT NULL,
    state       TEXT,
    postal_code TEXT NOT NULL,
    country     TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "order" (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customer(id),
    address_id   INTEGER NOT NULL REFERENCES address(id),
    status       TEXT NOT NULL DEFAULT 'pending',
    total_amount REAL NOT NULL DEFAULT 0,
    note         TEXT,
    ordered_at   TEXT NOT NULL DEFAULT (datetime('now')),
    shipped_at   TEXT
);

CREATE TABLE order_item (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES "order"(id),
    book_id    INTEGER NOT NULL REFERENCES book(id),
    quantity   INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL
);

CREATE TABLE review (
    id          INTEGER PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES book(id),
    customer_id INTEGER NOT NULL REFERENCES customer(id),
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       TEXT NOT NULL,
    body        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (book_id, customer_id)
);

-- Indexes
CREATE INDEX idx_book_author ON book(author_id);
CREATE INDEX idx_book_publisher ON book(publisher_id);
CREATE INDEX idx_address_customer ON address(customer_id);
CREATE INDEX idx_order_customer ON "order"(customer_id);
CREATE INDEX idx_order_status ON "order"(status);
CREATE INDEX idx_order_item_order ON order_item(order_id);
CREATE INDEX idx_review_book ON review(book_id);
CREATE INDEX idx_review_customer ON review(customer_id);
