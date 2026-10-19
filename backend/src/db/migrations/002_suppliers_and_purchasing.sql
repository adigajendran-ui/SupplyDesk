-- ============================================================
-- SupplyDesk migration 002
-- Suppliers, purchase orders, and receiving history
-- ============================================================

-- Suppliers ---------------------------------------------------

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(160) NOT NULL
        CHECK (char_length(btrim(name)) > 0),

    contact_name VARCHAR(120),

    email VARCHAR(254),

    phone VARCHAR(40),

    address TEXT,

    notes VARCHAR(1000),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        email IS NULL
        OR char_length(btrim(email)) > 0
    )
);

CREATE INDEX suppliers_name_lower_idx
    ON suppliers (LOWER(name));

CREATE INDEX suppliers_active_idx
    ON suppliers (is_active, name);

CREATE UNIQUE INDEX suppliers_email_lower_unique
    ON suppliers (LOWER(email))
    WHERE email IS NOT NULL;


-- Purchase order numbering -----------------------------------

CREATE SEQUENCE purchase_order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;


-- Purchase orders --------------------------------------------

CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_number VARCHAR(40) NOT NULL UNIQUE,

    supplier_id UUID NOT NULL
        REFERENCES suppliers(id) ON DELETE RESTRICT,

    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'ordered',
                'partially_received',
                'received',
                'cancelled'
            )
        ),

    expected_date DATE,

    ordered_at TIMESTAMPTZ,

    notes VARCHAR(1000),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchase_orders_supplier_idx
    ON purchase_orders (supplier_id, created_at DESC);

CREATE INDEX purchase_orders_status_idx
    ON purchase_orders (status, created_at DESC);

CREATE INDEX purchase_orders_created_idx
    ON purchase_orders (created_at DESC);


-- Purchase order line items ----------------------------------

CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    purchase_order_id UUID NOT NULL
        REFERENCES purchase_orders(id) ON DELETE CASCADE,

    product_id UUID NOT NULL
        REFERENCES products(id) ON DELETE RESTRICT,

    quantity_ordered INTEGER NOT NULL
        CHECK (quantity_ordered > 0),

    quantity_received INTEGER NOT NULL DEFAULT 0
        CHECK (quantity_received >= 0),

    unit_cost NUMERIC(12, 2) NOT NULL
        CHECK (unit_cost >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (quantity_received <= quantity_ordered),

    UNIQUE (purchase_order_id, product_id)
);

CREATE INDEX purchase_order_items_order_idx
    ON purchase_order_items (purchase_order_id);

CREATE INDEX purchase_order_items_product_idx
    ON purchase_order_items (product_id);


-- Receipt headers --------------------------------------------

CREATE TABLE purchase_order_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    purchase_order_id UUID NOT NULL
        REFERENCES purchase_orders(id) ON DELETE RESTRICT,

    receipt_reference VARCHAR(100),

    notes VARCHAR(1000),

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchase_order_receipts_order_idx
    ON purchase_order_receipts (purchase_order_id, received_at DESC);


-- Receipt line items -----------------------------------------

CREATE TABLE purchase_order_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    receipt_id UUID NOT NULL
        REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,

    purchase_order_item_id UUID NOT NULL
        REFERENCES purchase_order_items(id) ON DELETE RESTRICT,

    quantity_received INTEGER NOT NULL
        CHECK (quantity_received > 0),

    UNIQUE (receipt_id, purchase_order_item_id)
);

CREATE INDEX purchase_order_receipt_items_line_idx
    ON purchase_order_receipt_items (purchase_order_item_id);