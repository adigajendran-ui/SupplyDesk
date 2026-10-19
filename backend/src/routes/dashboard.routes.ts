import { Router } from "express";

import { pool } from "../db/pool.js";

export const dashboardRouter = Router();

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorder_point: number;
  unit_cost: string | number;
  location: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ActivityRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  movement_type: string;
  quantity_delta: number;
  quantity_after: number;
  reason: string;
  created_at: Date | string;
};

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    quantity: Number(row.quantity),
    reorderPoint: Number(row.reorder_point),
    unitCost: Number(row.unit_cost),
    location: row.location,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function serializeActivity(row: ActivityRow) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.name,
    sku: row.sku,
    movementType: row.movement_type,
    quantityDelta: Number(row.quantity_delta),
    quantityAfter: Number(row.quantity_after),
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

dashboardRouter.get("/summary", async (_request, response) => {
  try {
    const [
      metricsResult,
      attentionResult,
      activityResult,
      weeklyResult,
    ] = await Promise.all([
      pool.query<{
        product_count: number;
        total_units: string | number;
        inventory_value: string | number;
        low_stock_count: number;
        out_of_stock_count: number;
      }>(`
        SELECT
          COUNT(*)::int AS product_count,
          COALESCE(SUM(quantity), 0)::bigint AS total_units,
          COALESCE(
            SUM(quantity::numeric * unit_cost),
            0
          ) AS inventory_value,
          COUNT(*) FILTER (
            WHERE quantity > 0
              AND quantity <= reorder_point
          )::int AS low_stock_count,
          COUNT(*) FILTER (
            WHERE quantity = 0
          )::int AS out_of_stock_count
        FROM products
      `),

      pool.query<ProductRow>(`
        SELECT
          id, sku, name, category, quantity,
          reorder_point, unit_cost, location,
          created_at, updated_at
        FROM products
        WHERE quantity <= reorder_point
        ORDER BY
          (quantity = 0) DESC,
          quantity ASC,
          name ASC
        LIMIT 4
      `),

      pool.query<ActivityRow>(`
        SELECT
          m.id,
          m.product_id,
          p.name,
          p.sku,
          m.movement_type,
          m.quantity_delta,
          m.quantity_after,
          m.reason,
          m.created_at
        FROM stock_movements AS m
        INNER JOIN products AS p
          ON p.id = m.product_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 4
      `),

      pool.query<{
        day: string;
        units: string | number;
      }>(`
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE::timestamp - INTERVAL '6 days',
            CURRENT_DATE::timestamp,
            INTERVAL '1 day'
          )::date AS day
        )
        SELECT
          TO_CHAR(days.day, 'Dy') AS day,
          COALESCE(
            SUM(ABS(m.quantity_delta)),
            0
          )::bigint AS units
        FROM days
        LEFT JOIN stock_movements AS m
          ON m.created_at >= days.day::timestamptz
         AND m.created_at < (days.day + 1)::timestamptz
        GROUP BY days.day
        ORDER BY days.day
      `),
    ]);

    const metrics = metricsResult.rows[0];

    response.status(200).json({
      data: {
        metrics: {
          productCount: Number(metrics.product_count),
          totalUnits: Number(metrics.total_units),
          inventoryValue: Number(metrics.inventory_value),
          lowStockCount: Number(metrics.low_stock_count),
          outOfStockCount: Number(metrics.out_of_stock_count),
        },
        attentionProducts: attentionResult.rows.map(serializeProduct),
        recentActivity: activityResult.rows.map(serializeActivity),
        weeklyActivity: weeklyResult.rows.map((row) => ({
          day: row.day.trim(),
          units: Number(row.units),
        })),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve dashboard summary:", error);

    response.status(500).json({
      error: {
        code: "DASHBOARD_UNAVAILABLE",
        message: "The dashboard data could not be retrieved.",
      },
    });
  }
});