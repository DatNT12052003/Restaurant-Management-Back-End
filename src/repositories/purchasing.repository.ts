import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import {
    IPurchaseOrder,
    IPurchaseOrderLine,
    ISelectQuery,
    IStockTransfer,
    IStockTransferLine,
    ISupplier,
    ISupplierBill,
    ISupplierBody,
    ISupplierPayment,
    ISupplierPrice,
} from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

/** Giai đoạn 11: nhà cung cấp, đơn đặt hàng, chuyển kho, công nợ */

const withTotal = <T>(rows: (T & { total_count?: string })[]) => ({
    rows: rows.map(({ total_count, ...data }) => data as T),
    totalCount: rows.length > 0 ? parseInt(rows[0].total_count!, 10) : 0,
});

/** Đổi tên trường của client sang cột có alias; bỏ trường không có trong \`fieldMap\` (chống injection) */
const mapParams = (params: ISelectQuery, fieldMap: Record<string, string>, defaultOrder: string): ISelectQuery => {
    const orderBy = (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field);
    return {
        ...params,
        search: params.search?.text
            ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
            : undefined,
        filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
        orderBy: orderBy.length ? orderBy : [{ field: defaultOrder, direction: OrderTypeEnum.DESC }],
    };
};

/** Mã chứng từ kế tiếp trong ngày: {prefix}-R{id}-YYYYMMDD-NNN (giờ Việt Nam), khóa advisory theo nhà hàng */
const nextCode = async (prefix: string, table: string, restaurantCol: string, restaurantId: number): Promise<string> => {
    await db().query("SELECT pg_advisory_xact_lock(hashtext($1), $2)", [`code_${table}`, restaurantId]);
    const result = await db().query(
        `SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') AS day,
            (SELECT COUNT(*)::int + 1 FROM ${table}
             WHERE ${restaurantCol} = $1
                AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS seq`,
        [restaurantId],
    );
    const { day, seq } = result.rows[0];
    return `${prefix}-R${restaurantId}-${day}-${String(seq).padStart(3, "0")}`;
};

// ---------------------------------------------------------------------------
// Nhà cung cấp
// ---------------------------------------------------------------------------

const SUPPLIER_FIELDS = [
    "name",
    "contact_name",
    "phone",
    "email",
    "address",
    "tax_code",
    "payment_terms_days",
    "note",
    "status",
    "updated_at",
];

/** \`restaurantId\`: công nợ chỉ tính của nhà hàng này (null = cả chuỗi) */
export const getSuppliers = async (
    options: { search?: string; status?: string; restaurantId: number | null },
): Promise<ISupplier[]> => {
    const result = await db().query(
        `SELECT s.*,
            (SELECT COUNT(*)::int FROM supplier_ingredients si WHERE si.supplier_id = s.id) AS price_count,
            (SELECT COALESCE(SUM(b.amount - b.paid_amount), 0)::numeric(14,2) FROM supplier_bills b
                WHERE b.supplier_id = s.id AND b.status <> 'paid' AND ($3::int IS NULL OR b.restaurant_id = $3::int)) AS outstanding
        FROM suppliers s
        WHERE s.deleted_at IS NULL
            AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.phone ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR s.status = $2)
        ORDER BY lower(s.name)`,
        [options.search || null, options.status || null, options.restaurantId],
    );
    return result.rows;
};

export const getSupplierById = async (id: number, forUpdate = false): Promise<ISupplier | undefined> => {
    const result = await db().query(
        `SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
        [id],
    );
    return result.rows[0];
};

export const createSupplier = async (body: ISupplierBody): Promise<ISupplier> => {
    const { query, values } = buildInsertQuery("suppliers", body, SUPPLIER_FIELDS);
    return (await db().query(query, values)).rows[0];
};

export const updateSupplier = async (id: number, body: ISupplierBody): Promise<ISupplier | undefined> => {
    const { query, values } = buildUpdateQuery(
        "suppliers",
        { field: "id", value: id },
        { ...body, updated_at: new Date() },
        SUPPLIER_FIELDS,
        undefined,
        true,
    );
    return (await db().query(query, values)).rows[0];
};

export const deleteSupplier = async (id: number): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        "UPDATE suppliers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

/** Đơn chưa xong và khoản phải trả chưa trả hết của nhà cung cấp (chặn xóa) */
export const countSupplierOpenUsage = async (id: number): Promise<{ open_orders: number; unpaid_bills: number }> => {
    const result = await db().query(
        `SELECT
            (SELECT COUNT(*)::int FROM purchase_orders WHERE supplier_id = $1 AND status IN ('draft', 'sent', 'partial')) AS open_orders,
            (SELECT COUNT(*)::int FROM supplier_bills WHERE supplier_id = $1 AND status <> 'paid') AS unpaid_bills`,
        [id],
    );
    return result.rows[0];
};

export const getSupplierPrices = async (supplierId: number): Promise<ISupplierPrice[]> => {
    const result = await db().query(
        `SELECT si.*, g.name AS ingredient_name, g.unit FROM supplier_ingredients si
        JOIN ingredients g ON g.id = si.ingredient_id AND g.deleted_at IS NULL
        WHERE si.supplier_id = $1 ORDER BY lower(g.name)`,
        [supplierId],
    );
    return result.rows;
};

/** Giá các nhà cung cấp chào cho một nguyên liệu (rẻ nhất trước) */
export const getIngredientPrices = async (ingredientId: number): Promise<ISupplierPrice[]> => {
    const result = await db().query(
        `SELECT si.*, s.name AS supplier_name FROM supplier_ingredients si
        JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL AND s.status = 'active'
        WHERE si.ingredient_id = $1 ORDER BY si.is_preferred DESC, si.unit_price, lower(s.name)`,
        [ingredientId],
    );
    return result.rows;
};

export const replaceSupplierPrices = async (
    supplierId: number,
    items: { ingredient_id: number; unit_price: number; is_preferred?: boolean }[],
): Promise<void> => {
    await db().query("DELETE FROM supplier_ingredients WHERE supplier_id = $1", [supplierId]);
    if (items.length === 0) return;
    await db().query(
        `INSERT INTO supplier_ingredients (supplier_id, ingredient_id, unit_price, is_preferred)
        SELECT $1, x.ingredient_id, x.unit_price, COALESCE(x.is_preferred, false)
        FROM json_to_recordset($2::json) AS x(ingredient_id int, unit_price numeric, is_preferred boolean)`,
        [supplierId, JSON.stringify(items)],
    );
};

/** Cập nhật giá mới nhất khi nhận hàng (thêm vào bảng giá nếu chưa có) */
export const upsertSupplierPrice = async (supplierId: number, ingredientId: number, unitPrice: number): Promise<void> => {
    await db().query(
        `INSERT INTO supplier_ingredients (supplier_id, ingredient_id, unit_price) VALUES ($1, $2, $3)
        ON CONFLICT (supplier_id, ingredient_id) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
        [supplierId, ingredientId, unitPrice],
    );
};

// ---------------------------------------------------------------------------
// Đơn đặt hàng
// ---------------------------------------------------------------------------

const PO_FIELDS = ["code", "restaurant_id", "supplier_id", "status", "expected_date", "note", "total", "created_by", "sent_at", "closed_at", "cancel_reason", "updated_at"];

const PO_RETURNING = [
    "po.*",
    "to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date",
    "(SELECT s.name FROM suppliers s WHERE s.id = po.supplier_id) AS supplier_name",
    "(SELECT r.name FROM restaurants r WHERE r.id = po.restaurant_id) AS restaurant_name",
    "(SELECT u.full_name FROM users u WHERE u.id = po.created_by) AS created_by_name",
    "(SELECT COUNT(*)::int FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS line_count",
    "(SELECT COALESCE(SUM(ir.total_value), 0)::numeric(14,2) FROM inventory_receipts ir WHERE ir.purchase_order_id = po.id) AS received_value",
];

const PO_FIELD_MAP: Record<string, string> = {
    code: "po.code",
    restaurant_id: "po.restaurant_id",
    supplier_id: "po.supplier_id",
    status: "po.status",
    created_at: "po.created_at",
    expected_date: "po.expected_date",
    total: "po.total",
};

export const nextPurchaseOrderCode = (restaurantId: number) => nextCode("DH", "purchase_orders", "restaurant_id", restaurantId);

export const getPurchaseOrders = async (params: ISelectQuery): Promise<{ rows: IPurchaseOrder[]; totalCount: number }> => {
    const mapped = mapParams(params, PO_FIELD_MAP, "po.created_at");
    const { query, values } = buildSelectAllQuery("purchase_orders po", Object.values(PO_FIELD_MAP), {
        ...mapped,
        returning: PO_RETURNING,
        noSoftDelete: true,
    });
    return withTotal<IPurchaseOrder>((await db().query(query, values)).rows);
};

export const getPurchaseOrderById = async (id: number, forUpdate = false): Promise<IPurchaseOrder | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM purchase_orders WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${PO_RETURNING.join(", ")} FROM purchase_orders po WHERE po.id = $1`, [id]);
    return result.rows[0];
};

export const getPurchaseOrderLines = async (id: number, forUpdate = false): Promise<IPurchaseOrderLine[]> => {
    const result = await db().query(
        `SELECT l.*, g.name AS ingredient_name, g.unit, g.track_expiry, g.shelf_life_days
        FROM purchase_order_lines l JOIN ingredients g ON g.id = l.ingredient_id
        WHERE l.purchase_order_id = $1 ORDER BY l.id${forUpdate ? " FOR UPDATE OF l" : ""}`,
        [id],
    );
    return result.rows;
};

export const getPurchaseOrderReceipts = async (id: number) => {
    const result = await db().query(
        `SELECT r.id, r.code, r.total_value, r.created_at, u.full_name AS created_by_name
        FROM inventory_receipts r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.purchase_order_id = $1 ORDER BY r.created_at, r.id`,
        [id],
    );
    return result.rows;
};

export const createPurchaseOrder = async (row: Record<string, unknown>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("purchase_orders", row, PO_FIELDS, ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updatePurchaseOrder = async (id: number, row: Record<string, unknown>): Promise<void> => {
    const { query, values } = buildUpdateQuery(
        "purchase_orders",
        { field: "id", value: id },
        { ...row, updated_at: new Date() },
        PO_FIELDS,
        ["id"],
        // Bảng không có xóa mềm
        false,
    );
    await db().query(query, values);
};

/** Thay toàn bộ dòng của đơn nháp và tính lại tổng */
export const replacePurchaseOrderLines = async (
    id: number,
    lines: { ingredient_id: number; quantity: number; unit_price: number }[],
): Promise<void> => {
    await db().query("DELETE FROM purchase_order_lines WHERE purchase_order_id = $1", [id]);
    await db().query(
        `INSERT INTO purchase_order_lines (purchase_order_id, ingredient_id, quantity, unit_price)
        SELECT $1, x.ingredient_id, x.quantity, x.unit_price
        FROM json_to_recordset($2::json) AS x(ingredient_id int, quantity numeric, unit_price numeric)`,
        [id, JSON.stringify(lines)],
    );
    await db().query(
        `UPDATE purchase_orders SET total = (
            SELECT COALESCE(ROUND(SUM(quantity * unit_price), 2), 0) FROM purchase_order_lines WHERE purchase_order_id = $1
        ), updated_at = NOW() WHERE id = $1`,
        [id],
    );
};

export const addReceivedQuantity = async (lineId: number, quantity: number): Promise<void> => {
    await db().query("UPDATE purchase_order_lines SET received_quantity = received_quantity + $2 WHERE id = $1", [lineId, quantity]);
};

/**
 * Dữ liệu gợi ý đặt hàng của chi nhánh: tồn, ngưỡng, tiêu hao (consume) trong \`days\` ngày gần nhất,
 * hàng đang về (đơn đã gửi / nhận một phần) và giá của nhà cung cấp. \`supplierId\`: chỉ nguyên liệu có trong bảng giá.
 */
export const getSuggestionData = async (restaurantId: number, supplierId: number | null, days: number) => {
    const result = await db().query(
        `SELECT g.id AS ingredient_id, g.name, g.unit,
            COALESCE(inv.quantity, 0) AS stock, COALESCE(inv.min_quantity, 0) AS min_quantity,
            COALESCE((
                SELECT -SUM(t.quantity_change) FROM inventory_transactions t
                WHERE t.restaurant_id = $1 AND t.ingredient_id = g.id AND t.type = 'consume'
                    AND t.created_at >= NOW() - make_interval(days => $3::int)
            ), 0) / $3::numeric AS avg_daily_usage,
            COALESCE((
                SELECT SUM(GREATEST(l.quantity - l.received_quantity, 0)) FROM purchase_order_lines l
                JOIN purchase_orders po ON po.id = l.purchase_order_id
                WHERE po.restaurant_id = $1 AND po.status IN ('sent', 'partial') AND l.ingredient_id = g.id
            ), 0) AS incoming,
            si.unit_price
        FROM ingredients g
        LEFT JOIN inventory inv ON inv.ingredient_id = g.id AND inv.restaurant_id = $1
        LEFT JOIN supplier_ingredients si ON si.ingredient_id = g.id AND si.supplier_id = $2::int
        WHERE g.deleted_at IS NULL AND g.status = 'active' AND ($2::int IS NULL OR si.supplier_id IS NOT NULL)
        ORDER BY lower(g.name)`,
        [restaurantId, supplierId, days],
    );
    return result.rows as {
        ingredient_id: number;
        name: string;
        unit: string;
        stock: string;
        min_quantity: string;
        avg_daily_usage: string;
        incoming: string;
        unit_price: string | null;
    }[];
};

// ---------------------------------------------------------------------------
// Chuyển kho
// ---------------------------------------------------------------------------

const TRANSFER_RETURNING = [
    "st.*",
    "(SELECT r.name FROM restaurants r WHERE r.id = st.from_restaurant_id) AS from_restaurant_name",
    "(SELECT r.name FROM restaurants r WHERE r.id = st.to_restaurant_id) AS to_restaurant_name",
    "(SELECT u.full_name FROM users u WHERE u.id = st.created_by) AS created_by_name",
    "(SELECT u.full_name FROM users u WHERE u.id = st.received_by) AS received_by_name",
    "(SELECT COUNT(*)::int FROM stock_transfer_lines l WHERE l.transfer_id = st.id) AS line_count",
];

const TRANSFER_FIELD_MAP: Record<string, string> = {
    code: "st.code",
    status: "st.status",
    from_restaurant_id: "st.from_restaurant_id",
    to_restaurant_id: "st.to_restaurant_id",
    created_at: "st.created_at",
};

export const nextTransferCode = (restaurantId: number) => nextCode("CK", "stock_transfers", "from_restaurant_id", restaurantId);

export const getTransfers = async (params: ISelectQuery): Promise<{ rows: IStockTransfer[]; totalCount: number }> => {
    const mapped = mapParams(params, TRANSFER_FIELD_MAP, "st.created_at");
    const { query, values } = buildSelectAllQuery("stock_transfers st", Object.values(TRANSFER_FIELD_MAP), {
        ...mapped,
        returning: TRANSFER_RETURNING,
        noSoftDelete: true,
    });
    return withTotal<IStockTransfer>((await db().query(query, values)).rows);
};

export const getTransferById = async (id: number, forUpdate = false): Promise<IStockTransfer | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM stock_transfers WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${TRANSFER_RETURNING.join(", ")} FROM stock_transfers st WHERE st.id = $1`, [id]);
    return result.rows[0];
};

export const getTransferLines = async (id: number): Promise<IStockTransferLine[]> => {
    const result = await db().query(
        `SELECT l.*, g.name AS ingredient_name, g.unit FROM stock_transfer_lines l JOIN ingredients g ON g.id = l.ingredient_id
        WHERE l.transfer_id = $1 ORDER BY l.id`,
        [id],
    );
    return result.rows;
};

export const createTransfer = async (row: {
    code: string;
    from_restaurant_id: number;
    to_restaurant_id: number;
    note: string | null;
    created_by: number | null;
}): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery(
        "stock_transfers",
        row,
        ["code", "from_restaurant_id", "to_restaurant_id", "note", "created_by"],
        ["id"],
    );
    return (await db().query(query, values)).rows[0];
};

export const insertTransferLines = async (
    transferId: number,
    lines: { ingredient_id: number; quantity: number; unit_cost: number; lots: unknown[] }[],
): Promise<void> => {
    await db().query(
        `INSERT INTO stock_transfer_lines (transfer_id, ingredient_id, quantity, unit_cost, lots)
        SELECT $1, x.ingredient_id, x.quantity, x.unit_cost, x.lots
        FROM json_to_recordset($2::json) AS x(ingredient_id int, quantity numeric, unit_cost numeric, lots jsonb)`,
        [transferId, JSON.stringify(lines)],
    );
    await db().query(
        `UPDATE stock_transfers SET total_value = (
            SELECT COALESCE(ROUND(SUM(quantity * unit_cost), 2), 0) FROM stock_transfer_lines WHERE transfer_id = $1
        ) WHERE id = $1`,
        [transferId],
    );
};

export const updateTransfer = async (id: number, row: Record<string, unknown>): Promise<void> => {
    const { query, values } = buildUpdateQuery(
        "stock_transfers",
        { field: "id", value: id },
        { ...row, updated_at: new Date() },
        ["status", "received_by", "received_at", "cancelled_at", "loss_value", "updated_at"],
        ["id"],
        false,
    );
    await db().query(query, values);
};

export const setTransferLineReceived = async (lineId: number, quantity: number): Promise<void> => {
    await db().query("UPDATE stock_transfer_lines SET received_quantity = $2 WHERE id = $1", [lineId, quantity]);
};

// ---------------------------------------------------------------------------
// Công nợ nhà cung cấp
// ---------------------------------------------------------------------------

const BILL_RETURNING = [
    "b.*",
    "to_char(b.due_date, 'YYYY-MM-DD') AS due_date",
    "(b.amount - b.paid_amount)::numeric(14,2) AS remaining",
    "(b.status <> 'paid' AND b.due_date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS overdue",
    "(SELECT s.name FROM suppliers s WHERE s.id = b.supplier_id) AS supplier_name",
    "(SELECT r.name FROM restaurants r WHERE r.id = b.restaurant_id) AS restaurant_name",
    "(SELECT po.code FROM purchase_orders po WHERE po.id = b.purchase_order_id) AS purchase_order_code",
    "(SELECT ir.code FROM inventory_receipts ir WHERE ir.id = b.receipt_id) AS receipt_code",
];

const BILL_FIELD_MAP: Record<string, string> = {
    supplier_id: "b.supplier_id",
    restaurant_id: "b.restaurant_id",
    status: "b.status",
    due_date: "b.due_date",
    created_at: "b.created_at",
    amount: "b.amount",
};

export const createBill = async (row: {
    supplier_id: number;
    restaurant_id: number;
    purchase_order_id: number | null;
    receipt_id: number;
    amount: number;
    due_date: string;
    status: string;
}): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery(
        "supplier_bills",
        row,
        ["supplier_id", "restaurant_id", "purchase_order_id", "receipt_id", "amount", "due_date", "status"],
        ["id"],
    );
    return (await db().query(query, values)).rows[0];
};

export const getBills = async (params: ISelectQuery): Promise<{ rows: ISupplierBill[]; totalCount: number }> => {
    const mapped = mapParams(params, BILL_FIELD_MAP, "b.due_date");
    const { query, values } = buildSelectAllQuery("supplier_bills b", Object.values(BILL_FIELD_MAP), {
        ...mapped,
        returning: BILL_RETURNING,
        noSoftDelete: true,
    });
    return withTotal<ISupplierBill>((await db().query(query, values)).rows);
};

/** Tổng còn phải trả và quá hạn theo cùng bộ lọc (không phân trang) */
export const sumBills = async (params: ISelectQuery): Promise<{ outstanding: string; overdue: string; bills: number }> => {
    const mapped = mapParams(params, BILL_FIELD_MAP, "b.due_date");
    const { query, values } = buildSelectAllQuery("supplier_bills b", Object.values(BILL_FIELD_MAP), {
        ...mapped,
        orderBy: [],
        returning: ["b.amount", "b.paid_amount", "b.status", "b.due_date"],
        noSoftDelete: true,
        limit: 1_000_000_000,
        offset: 0,
    });
    const result = await db().query(
        `SELECT COALESCE(SUM(amount - paid_amount) FILTER (WHERE status <> 'paid'), 0)::numeric(14,2) AS outstanding,
            COALESCE(SUM(amount - paid_amount) FILTER (
                WHERE status <> 'paid' AND due_date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            ), 0)::numeric(14,2) AS overdue,
            COUNT(*)::int AS bills
        FROM (${query}) x`,
        values,
    );
    return result.rows[0];
};

export const getBillById = async (id: number, forUpdate = false): Promise<ISupplierBill | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM supplier_bills WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${BILL_RETURNING.join(", ")} FROM supplier_bills b WHERE b.id = $1`, [id]);
    return result.rows[0];
};

export const getBillPayments = async (billId: number): Promise<ISupplierPayment[]> => {
    const result = await db().query(
        `SELECT p.*, u.full_name AS created_by_name FROM supplier_payments p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.bill_id = $1 ORDER BY p.paid_at, p.id`,
        [billId],
    );
    return result.rows;
};

export const insertBillPayment = async (row: {
    bill_id: number;
    amount: number;
    method: string;
    reference: string | null;
    note: string | null;
    paid_at: Date;
    created_by: number | null;
}): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery(
        "supplier_payments",
        row,
        ["bill_id", "amount", "method", "reference", "note", "paid_at", "created_by"],
        ["id"],
    );
    return (await db().query(query, values)).rows[0];
};

export const setBillPaid = async (id: number, paidAmount: number, status: string): Promise<void> => {
    await db().query("UPDATE supplier_bills SET paid_amount = $2, status = $3, updated_at = NOW() WHERE id = $1", [id, paidAmount, status]);
};
