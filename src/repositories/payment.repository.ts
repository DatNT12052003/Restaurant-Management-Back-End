import { OrderTypeEnum, PaymentStatusEnum, PaymentTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IInvoiceLine, IPayment, IPaymentRow, IPaymentSummary, ISelectQuery } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

const WRITABLE_FIELDS = [
    "order_id",
    "restaurant_id",
    "type",
    "method",
    "amount",
    "status",
    "received_amount",
    "change_amount",
    "reference",
    "note",
    "refund_of_payment_id",
    "cashier_id",
    "paid_at",
    "updated_at",
];

/** Tiền đã hoàn cho payment `p` */
const REFUNDED = `(SELECT COALESCE(SUM(rf.amount), 0)::numeric(12,2) FROM payments rf
    WHERE rf.refund_of_payment_id = p.id AND rf.status = 'paid') AS refunded_amount`;

const RETURNING = [
    "p.*",
    "(SELECT u.full_name FROM users u WHERE u.id = p.cashier_id) AS cashier_name",
    "(SELECT o.code FROM orders o WHERE o.id = p.order_id) AS order_code",
    REFUNDED,
];

const FIELD_MAP: Record<string, string> = {
    order_id: "p.order_id",
    restaurant_id: "p.restaurant_id",
    type: "p.type",
    method: "p.method",
    status: "p.status",
    cashier_id: "p.cashier_id",
    amount: "p.amount",
    created_at: "p.created_at",
    paid_at: "p.paid_at",
};

const mapParams = (params: ISelectQuery): ISelectQuery => ({
    ...params,
    filters: (params.filters || []).map((f) => ({ ...f, field: FIELD_MAP[f.field] })).filter((f) => f.field),
    orderBy: (params.orderBy || []).map((o) => ({ ...o, field: FIELD_MAP[o.field] })).filter((o) => o.field),
    search: undefined,
});

export const getPayments = async (params: ISelectQuery): Promise<{ rows: IPayment[]; totalCount: number }> => {
    const mapped = mapParams(params);
    const { query, values } = buildSelectAllQuery("payments p", Object.values(FIELD_MAP), {
        ...mapped,
        returning: RETURNING,
        noSoftDelete: true,
        orderBy: mapped.orderBy?.length ? mapped.orderBy : [{ field: "p.created_at", direction: OrderTypeEnum.DESC }],
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

/** Tổng thu / hoàn theo cùng bộ lọc với danh sách (không phân trang) */
export const sumPayments = async (params: ISelectQuery): Promise<{ collected: string; refunded: string }> => {
    const mapped = mapParams(params);
    const { query, values } = buildSelectAllQuery("payments p", Object.values(FIELD_MAP), {
        ...mapped,
        noSoftDelete: true,
        orderBy: [],
        returning: ["p.type", "p.status", "p.amount"],
        limit: 1_000_000_000,
        offset: 0,
    });
    // Dùng lại đúng câu lọc của danh sách làm subquery (ORDER BY / LIMIT bên trong vẫn hợp lệ)
    const inner = query;
    const result = await db().query(
        `SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'payment' AND status IN ('paid', 'refunded')), 0)::numeric(12,2) AS collected,
            COALESCE(SUM(amount) FILTER (WHERE type = 'refund' AND status = 'paid'), 0)::numeric(12,2) AS refunded
        FROM (${inner}) x`,
        values,
    );
    return result.rows[0];
};

export const getPaymentById = async (id: number, forUpdate = false): Promise<IPayment | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM payments WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${RETURNING.join(", ")} FROM payments p WHERE p.id = $1`, [id]);
    return result.rows[0];
};

export const getOrderPayments = async (orderId: number): Promise<IPayment[]> => {
    const result = await db().query(
        `SELECT ${RETURNING.join(", ")} FROM payments p WHERE p.order_id = $1 ORDER BY p.created_at, p.id`,
        [orderId],
    );
    return result.rows;
};

/** Đã thu (payment paid/refunded trừ các lần hoàn) và đang chờ xác nhận */
export const getSummary = async (orderId: number): Promise<IPaymentSummary> => {
    const result = await db().query(
        `SELECT
            COALESCE(SUM(CASE
                WHEN type = 'payment' AND status IN ('paid', 'refunded') THEN amount
                WHEN type = 'refund' AND status = 'paid' THEN -amount
                ELSE 0 END), 0) AS paid,
            COALESCE(SUM(amount) FILTER (WHERE type = 'payment' AND status IN ('pending', 'processing')), 0) AS pending
        FROM payments WHERE order_id = $1`,
        [orderId],
    );
    return { paid: Number(result.rows[0].paid), pending: Number(result.rows[0].pending) };
};

export const createPayment = async (row: IPaymentRow): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("payments", row, WRITABLE_FIELDS, ["id"]);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updatePayment = async (id: number, row: IPaymentRow): Promise<void> => {
    const { query, values } = buildUpdateQuery("payments", { field: "id", value: id }, { ...row, updated_at: new Date() }, WRITABLE_FIELDS, ["id"]);
    await db().query(query, values);
};

/** Hủy mọi giao dịch đang chờ của order (khi hủy order) */
export const cancelPendingPayments = async (orderId: number): Promise<number[]> => {
    const result = await db().query(
        `UPDATE payments SET status = $2, updated_at = NOW()
        WHERE order_id = $1 AND type = $3 AND status IN ('pending', 'processing') RETURNING id`,
        [orderId, PaymentStatusEnum.CANCELLED, PaymentTypeEnum.PAYMENT],
    );
    return result.rows.map((r) => r.id);
};

/** Dòng hóa đơn: gộp các dòng chưa hủy cùng món, cùng đơn giá */
export const getInvoiceLines = async (orderId: number): Promise<IInvoiceLine[]> => {
    const result = await db().query(
        `SELECT kind, item_id, name, unit_price, SUM(quantity)::int AS quantity,
            (unit_price * SUM(quantity))::numeric(12,2) AS amount
        FROM (
            SELECT 'dish' AS kind, l.dish_id AS item_id, d.name, l.current_price AS unit_price, l.quantity, l.created_at
            FROM order_items l JOIN dishes d ON d.id = l.dish_id
            WHERE l.order_id = $1 AND l.status <> 'cancelled'
            UNION ALL
            SELECT 'combo', l.combo_id, c.name, l.current_price, l.quantity, l.created_at
            FROM order_combos l JOIN combos c ON c.id = l.combo_id
            WHERE l.order_id = $1 AND l.status <> 'cancelled'
        ) x
        GROUP BY kind, item_id, name, unit_price
        ORDER BY MIN(created_at), name`,
        [orderId],
    );
    return result.rows;
};
