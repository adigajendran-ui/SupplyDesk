CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sku VARCHAR(50) NOT NULL
        CHECK (char_length(btrim(sku)) > 0),

    name VARCHAR(120) NOT NULL
        CHECK (char_length(btrim(name)) > 0),

    category VARCHAR(80) NOT NULL
        CHECK (char_length(btrim(category)) > 0),

    quantity INTEGER NOT NULL DEFAULT 0
        CHECK (quantity >= 0),

    reorder_point INTEGER NOT NULL DEFAULT 10
        CHECK (reorder_point >= 0),

    unit_cost NUMERIC(12, 2) NOT NULL
        CHECK (unit_cost >= 0),

    location VARCHAR(80) NOT NULL
        CHECK (char_length(btrim(location)) > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SKUs must be unique regardless of letter casing.
CREATE UNIQUE INDEX products_sku_lower_unique
    ON products (LOWER(sku));

CREATE INDEX products_category_idx
    ON products (category);

CREATE INDEX products_name_lower_idx
    ON products (LOWER(name));

CREATE INDEX products_stock_status_idx
    ON products (quantity, reorder_point);


CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    product_id UUID NOT NULL
        REFERENCES products(id) ON DELETE RESTRICT,

    movement_type VARCHAR(30) NOT NULL
        CHECK (
            movement_type IN (
                'opening_balance',
                'received',
                'adjustment_in',
                'adjustment_out',
                'order_fulfilled',
                'transfer_in',
                'transfer_out'
            )
        ),

    quantity_delta INTEGER NOT NULL
        CHECK (quantity_delta <> 0),

    quantity_after INTEGER NOT NULL
        CHECK (quantity_after >= 0),

    reason VARCHAR(500) NOT NULL
        CHECK (char_length(btrim(reason)) > 0),

    reference_type VARCHAR(40),

    reference_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX stock_movements_product_created_idx
    ON stock_movements (product_id, created_at DESC);

CREATE INDEX stock_movements_created_idx
    ON stock_movements (created_at DESC);