import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import {
    IIngredient,
    IIngredientBody,
    IInventoryReceipt,
    IInventoryRow,
    IInventoryTransaction,
    ISelectQuery,
    IStockItem,
} from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

const INGREDIENT_FIELDS = ["name", "unit", "description", "status", "updated_at"];

const withTotal = <T>(rows: (T & { total_count?: string })[]) => ({
    rows: rows.map(({ total_count, ...data }) => data as T),
    totalCount: rows.length > 0 ? parseInt(rows[0].total_count!, 10) : 0,
});

const mapParams = (params: ISelectQuery, fieldMap: Record<string, string>): ISelectQuery => ({
    ...params,
    search: params.search?.text
        ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
        : undefined,
    filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
    orderBy: (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field),
});

// ---------------------------------------------------------------------------
// Nguyên liệu
// ---------------------------------------------------------------------------

export const getIngredients = async (search?: string, status?: string): Promise<IIngredient[]> => {
    const values: unknown[] = [];
    const where = ["deleted_at IS NULL"];
    if (search) {
        values.push(`%${search}%`);
        where.push(`name ILIKE $${values.length}`);
    }
    if (status) {
        values.push(status);
        where.push(`status = $${values.length}`);
    }
    const result = await db().query(`SELECT * FROM ingredients WHERE ${where.join(" AND ")} ORDER BY lower(name)`, values);
    return result.rows;
};

export const getIngredientById = async (id: number, forUpdate = false): Promise<IIngredient | undefined> => {
    const result = await db().query(
        `SELECT * FROM ingredients WHERE id = $1 AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
        [id],
    );
    return result.rows[0];
};

export const getIngredientsByIds = async (ids: number[]): Promise<IIngredient[]> => {
    if (ids.length === 0) return [];
    const result = await db().query("SELECT * FROM ingredients WHERE id = ANY($1::int[]) AND deleted_at IS NULL", [ids]);
    return result.rows;
};

export const createIngredient = async (body: IIngredientBody): Promise<IIngredient> => {
    const { query, values } = buildInsertQuery("ingredients", body, INGREDIENT_FIELDS);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateIngredient = async (id: number, body: IIngredientBody): Promise<IIngredient | undefined> => {
    const { query, values } = buildUpdateQuery(
        "ingredients",
        { field: "id", value: id },
        { ...body, updated_at: new Date() },
        INGREDIENT_FIELDS,
        ["*"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const deleteIngredient = async (id: number): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        "UPDATE ingredients SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

/** Tổng tồn kho của nguyên liệu ở mọi nhà hàng, và đã từng có biến động chưa */
export const getIngredientUsage = async (id: number): Promise<{ stock: number; has_transactions: boolean }> => {
    const result = await db().query(
        `SELECT
            -- Tồn có thể âm (giai đoạn 10): còn tồn khác 0 ở bất kỳ chi nhánh nào
            COALESCE((SELECT SUM(ABS(quantity)) FROM inventory WHERE ingredient_id = $1), 0) AS stock,
            EXISTS (SELECT 1 FROM inventory_transactions WHERE ingredient_id = $1) AS has_transactions`,
        [id],
    );
    return { stock: Number(result.rows[0].stock), has_transactions: result.rows[0].has_transactions };
};

// ---------------------------------------------------------------------------
// Tồn kho
// ---------------------------------------------------------------------------

/** Tồn kho của nhà hàng: mọi nguyên liệu chưa xóa (chưa có dòng inventory -> 0) */
export const getStock = async (
    restaurantId: number,
    options: { lowOnly?: boolean; includeInactive?: boolean } = {},
): Promise<IStockItem[]> => {
    const where = ["i.deleted_at IS NULL"];
    if (!options.includeInactive) where.push("(i.status = 'active' OR COALESCE(inv.quantity, 0) > 0)");
    // Tồn âm (tự trừ kho khi thiếu) luôn tính là tồn thấp
    const isLow = "(COALESCE(inv.quantity, 0) < 0 OR (COALESCE(inv.min_quantity, 0) > 0 AND COALESCE(inv.quantity, 0) <= inv.min_quantity))";
    if (options.lowOnly) where.push(isLow);
    const result = await db().query(
        `SELECT i.id AS ingredient_id, i.name, i.unit, i.status,
            COALESCE(inv.quantity, 0)::numeric(14,3) AS quantity,
            COALESCE(inv.min_quantity, 0)::numeric(14,3) AS min_quantity,
            COALESCE(inv.avg_unit_cost, 0)::numeric(14,2) AS avg_unit_cost,
            ROUND(COALESCE(inv.quantity, 0) * COALESCE(inv.avg_unit_cost, 0), 2)::numeric(14,2) AS stock_value,
            ${isLow} AS is_low,
            (SELECT MAX(t.created_at) FROM inventory_transactions t
                WHERE t.restaurant_id = $1 AND t.ingredient_id = i.id) AS last_change_at
        FROM ingredients i
        LEFT JOIN inventory inv ON inv.ingredient_id = i.id AND inv.restaurant_id = $1
        WHERE ${where.join(" AND ")}
        ORDER BY ${isLow} DESC, lower(i.name)`,
        [restaurantId],
    );
    return result.rows;
};

/**
 * Bảo đảm có dòng inventory cho các nguyên liệu rồi khóa chúng (theo thứ tự id để tránh deadlock).
 * Gọi trong transaction.
 */
export const lockInventoryRows = async (restaurantId: number, ingredientIds: number[]): Promise<Map<number, IInventoryRow>> => {
    const ids = [...ingredientIds].sort((a, b) => a - b);
    await db().query(
        `INSERT INTO inventory (restaurant_id, ingredient_id)
        SELECT $1, unnest($2::int[]) ON CONFLICT (restaurant_id, ingredient_id) DO NOTHING`,
        [restaurantId, ids],
    );
    const result = await db().query(
        `SELECT * FROM inventory WHERE restaurant_id = $1 AND ingredient_id = ANY($2::int[])
        ORDER BY ingredient_id FOR UPDATE`,
        [restaurantId, ids],
    );
    return new Map(result.rows.map((r: IInventoryRow) => [r.ingredient_id, r]));
};

export const updateInventoryRow = async (
    restaurantId: number,
    ingredientId: number,
    quantity: number,
    avgUnitCost: number,
): Promise<void> => {
    await db().query(
        `UPDATE inventory SET quantity = $3, avg_unit_cost = $4, updated_at = NOW()
        WHERE restaurant_id = $1 AND ingredient_id = $2`,
        [restaurantId, ingredientId, quantity, avgUnitCost],
    );
};

/** Đặt ngưỡng tồn tối thiểu (không đổi số lượng) */
export const setMinQuantity = async (restaurantId: number, ingredientId: number, minQuantity: number): Promise<void> => {
    await db().query(
        `INSERT INTO inventory (restaurant_id, ingredient_id, min_quantity) VALUES ($1, $2, $3)
        ON CONFLICT (restaurant_id, ingredient_id) DO UPDATE SET min_quantity = EXCLUDED.min_quantity, updated_at = NOW()`,
        [restaurantId, ingredientId, minQuantity],
    );
};

// ---------------------------------------------------------------------------
// Phiếu kho và sổ biến động
// ---------------------------------------------------------------------------

const RECEIPT_PREFIX: Record<string, string> = { import: "NK", export: "XK", adjust: "KK" };

/** Mã phiếu kế tiếp trong ngày: NK|XK|KK-R{id}-YYYYMMDD-NNN (giờ Việt Nam), khóa advisory theo nhà hàng */
export const nextReceiptCode = async (type: string, restaurantId: number): Promise<string> => {
    await db().query("SELECT pg_advisory_xact_lock(hashtext('inventory_receipt'), $1)", [restaurantId]);
    const result = await db().query(
        `SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') AS day,
            (SELECT COUNT(*)::int + 1 FROM inventory_receipts
             WHERE restaurant_id = $1 AND type = $2
                AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS seq`,
        [restaurantId, type],
    );
    const { day, seq } = result.rows[0];
    return `${RECEIPT_PREFIX[type]}-R${restaurantId}-${day}-${String(seq).padStart(3, "0")}`;
};

export const createReceipt = async (row: {
    code: string;
    restaurant_id: number;
    type: string;
    supplier: string | null;
    reason: string | null;
    note: string | null;
    total_value: number;
    created_by: number | null;
}): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery(
        "inventory_receipts",
        row,
        ["code", "restaurant_id", "type", "supplier", "reason", "note", "total_value", "created_by"],
        ["id"],
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const insertTransactions = async (
    rows: {
        restaurant_id: number;
        ingredient_id: number;
        receipt_id: number | null;
        type: string;
        quantity_change: number;
        quantity_after: number;
        unit_price: number;
        reason: string | null;
        created_by: number | null;
        /** Giao dịch `consume`: dòng món gây ra (order_item | order_combo) */
        reference_type?: string | null;
        reference_id?: number | null;
    }[],
): Promise<void> => {
    if (rows.length === 0) return;
    await db().query(
        `INSERT INTO inventory_transactions
            (restaurant_id, ingredient_id, receipt_id, type, quantity_change, quantity_after, unit_price, reason, created_by,
             reference_type, reference_id)
        SELECT x.restaurant_id, x.ingredient_id, x.receipt_id, x.type, x.quantity_change, x.quantity_after,
            x.unit_price, x.reason, x.created_by, x.reference_type, x.reference_id
        FROM json_to_recordset($1::json) AS x(
            restaurant_id int, ingredient_id int, receipt_id int, type text, quantity_change numeric,
            quantity_after numeric, unit_price numeric, reason text, created_by int, reference_type text, reference_id int)`,
        [JSON.stringify(rows)],
    );
};

const RECEIPT_RETURNING = [
    "r.*",
    "(SELECT u.full_name FROM users u WHERE u.id = r.created_by) AS created_by_name",
    "(SELECT COUNT(*)::int FROM inventory_transactions t WHERE t.receipt_id = r.id) AS line_count",
];

export const getReceipts = async (params: ISelectQuery): Promise<{ rows: IInventoryReceipt[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        code: "r.code",
        restaurant_id: "r.restaurant_id",
        type: "r.type",
        supplier: "r.supplier",
        created_by: "r.created_by",
        created_at: "r.created_at",
        total_value: "r.total_value",
    };
    const mapped = mapParams(params, fieldMap);
    const { query, values } = buildSelectAllQuery("inventory_receipts r", Object.values(fieldMap), {
        ...mapped,
        noSoftDelete: true,
        returning: RECEIPT_RETURNING,
        orderBy: mapped.orderBy?.length ? mapped.orderBy : [{ field: "r.created_at", direction: OrderTypeEnum.DESC }],
    });
    return withTotal<IInventoryReceipt>((await db().query(query, values)).rows);
};

export const getReceiptById = async (id: number): Promise<IInventoryReceipt | undefined> => {
    const result = await db().query(`SELECT ${RECEIPT_RETURNING.join(", ")} FROM inventory_receipts r WHERE r.id = $1`, [id]);
    return result.rows[0];
};

const TRANSACTION_SELECT = `SELECT t.*, i.name AS ingredient_name, i.unit,
    (SELECT r.code FROM inventory_receipts r WHERE r.id = t.receipt_id) AS receipt_code,
    (SELECT u.full_name FROM users u WHERE u.id = t.created_by) AS created_by_name
    FROM inventory_transactions t JOIN ingredients i ON i.id = t.ingredient_id`;

export const getReceiptLines = async (receiptId: number): Promise<IInventoryTransaction[]> => {
    const result = await db().query(`${TRANSACTION_SELECT} WHERE t.receipt_id = $1 ORDER BY lower(i.name)`, [receiptId]);
    return result.rows;
};

export const getTransactions = async (
    params: ISelectQuery,
): Promise<{ rows: IInventoryTransaction[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        restaurant_id: "t.restaurant_id",
        ingredient_id: "t.ingredient_id",
        type: "t.type",
        receipt_id: "t.receipt_id",
        created_by: "t.created_by",
        created_at: "t.created_at",
    };
    const mapped = mapParams(params, fieldMap);
    const { query, values } = buildSelectAllQuery("inventory_transactions t", Object.values(fieldMap), {
        ...mapped,
        noSoftDelete: true,
        joins: [{ table: "ingredients i", on: "i.id = t.ingredient_id" }],
        returning: [
            "t.*",
            "i.name AS ingredient_name",
            "i.unit",
            "(SELECT r.code FROM inventory_receipts r WHERE r.id = t.receipt_id) AS receipt_code",
            "(SELECT u.full_name FROM users u WHERE u.id = t.created_by) AS created_by_name",
        ],
        orderBy: mapped.orderBy?.length ? mapped.orderBy : [{ field: "t.created_at", direction: OrderTypeEnum.DESC }],
    });
    return withTotal<IInventoryTransaction>((await db().query(query, values)).rows);
};
