-- Bookstore demo schema for PostgreSQL

DROP TABLE IF EXISTS review CASCADE;
DROP TABLE IF EXISTS order_item CASCADE;
DROP TABLE IF EXISTS "order" CASCADE;
DROP TABLE IF EXISTS address CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
DROP TABLE IF EXISTS book_category CASCADE;
DROP TABLE IF EXISTS book CASCADE;
DROP TABLE IF EXISTS category CASCADE;
DROP TABLE IF EXISTS publisher CASCADE;
DROP TABLE IF EXISTS author CASCADE;

CREATE TABLE author (
    id          SERIAL PRIMARY KEY,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    bio         TEXT,
    birth_year  INTEGER,
    country     VARCHAR(100),
    website     VARCHAR(255),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE publisher (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    country      VARCHAR(100),
    founded_year INTEGER,
    website      VARCHAR(255),
    email        VARCHAR(255),
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE category (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    parent_id   INTEGER REFERENCES category(id)
);

CREATE TABLE book (
    id             SERIAL PRIMARY KEY,
    title          VARCHAR(300) NOT NULL,
    isbn           VARCHAR(13) NOT NULL UNIQUE,
    author_id      INTEGER NOT NULL REFERENCES author(id),
    publisher_id   INTEGER NOT NULL REFERENCES publisher(id),
    publish_year   INTEGER,
    pages          INTEGER,
    price          DECIMAL(10,2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    language       VARCHAR(50) NOT NULL DEFAULT 'English',
    description    TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE book_category (
    book_id     INTEGER NOT NULL REFERENCES book(id),
    category_id INTEGER NOT NULL REFERENCES category(id),
    PRIMARY KEY (book_id, category_id)
);

CREATE TABLE customer (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    phone         VARCHAR(50),
    registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE address (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customer(id),
    label       VARCHAR(50) NOT NULL,
    street      VARCHAR(255) NOT NULL,
    city        VARCHAR(100) NOT NULL,
    state       VARCHAR(100),
    postal_code VARCHAR(20) NOT NULL,
    country     VARCHAR(100) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE "order" (
    id           SERIAL PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customer(id),
    address_id   INTEGER NOT NULL REFERENCES address(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    note         TEXT,
    ordered_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    shipped_at   TIMESTAMP
);

CREATE TABLE order_item (
    id         SERIAL PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES "order"(id),
    book_id    INTEGER NOT NULL REFERENCES book(id),
    quantity   INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL
);

CREATE TABLE review (
    id          SERIAL PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES book(id),
    customer_id INTEGER NOT NULL REFERENCES customer(id),
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       VARCHAR(200) NOT NULL,
    body        TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
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
