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
    "tip_amount",
    "tip_staff_id",
    "provider",
    "gateway_ref",
    "gateway_data",
    "expires_at",
    "updated_at",
];

/** Tiền đã hoàn cho payment `p` */
const REFUNDED = `(SELECT COALESCE(SUM(rf.amount), 0)::numeric(12,2) FROM payments rf
    WHERE rf.refund_of_payment_id = p.id AND rf.status = 'paid') AS refunded_amount`;

const RETURNING = [
    "p.*",
    "(SELECT u.full_name FROM users u WHERE u.id = p.cashier_id) AS cashier_name",
    "(SELECT u.full_name FROM users u WHERE u.id = p.tip_staff_id) AS tip_staff_name",
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
export const sumPayments = async (params: ISelectQuery): Promise<{ collected: string; refunded: string; tips: string }> => {
    const mapped = mapParams(params);
    const { query, values } = buildSelectAllQuery("payments p", Object.values(FIELD_MAP), {
        ...mapped,
        noSoftDelete: true,
        orderBy: [],
        returning: ["p.type", "p.status", "p.amount", "p.tip_amount"],
        limit: 1_000_000_000,
        offset: 0,
    });
    // Dùng lại đúng câu lọc của danh sách làm subquery (ORDER BY / LIMIT bên trong vẫn hợp lệ)
    const inner = query;
    const result = await db().query(
        `SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'payment' AND status IN ('paid', 'refunded')), 0)::numeric(12,2) AS collected,
            COALESCE(SUM(amount) FILTER (WHERE type = 'refund' AND status = 'paid'), 0)::numeric(12,2) AS refunded,
            COALESCE(SUM(tip_amount) FILTER (WHERE type = 'payment' AND status IN ('paid', 'refunded')), 0)::numeric(12,2) AS tips
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

// ---------------------------------------------------------------------------
// Giai đoạn 14: payment QR chuyển khoản
// ---------------------------------------------------------------------------

/** Payment QR chưa thanh toán của order (kể cả đã quá hạn nhưng job chưa kịp hủy) */
export const getOpenQrPayments = async (orderId: number): Promise<IPayment[]> => {
    const result = await db().query(
        `SELECT ${RETURNING.join(", ")} FROM payments p
        WHERE p.order_id = $1 AND p.type = 'payment' AND p.status = 'processing' AND p.gateway_ref IS NOT NULL
        ORDER BY p.id`,
        [orderId],
    );
    return result.rows;
};

export const getPaymentByGatewayRef = async (ref: string): Promise<IPayment | undefined> => {
    const result = await db().query(`SELECT ${RETURNING.join(", ")} FROM payments p WHERE p.gateway_ref = $1`, [ref]);
    return result.rows[0];
};

/** Hủy các payment QR của order (đổi số tiền, tạo mã mới, ghi nhận tay). Trả về id đã hủy. */
export const cancelQrPayments = async (ids: number[], note: string): Promise<number[]> => {
    if (!ids.length) return [];
    const result = await db().query(
        `UPDATE payments SET status = 'cancelled', note = COALESCE(note, $2), updated_at = NOW()
        WHERE id = ANY($1::int[]) AND status = 'processing' RETURNING id`,
        [ids, note],
    );
    return result.rows.map((r) => r.id);
};

/** Hủy các payment QR đã quá hạn (job mỗi phút). Trả về payment đã hủy để phát sự kiện. */
export const expireQrPayments = async (): Promise<{ id: number; order_id: number; restaurant_id: number }[]> => {
    const result = await db().query(
        `UPDATE payments SET status = 'cancelled', note = COALESCE(note, 'expired'), updated_at = NOW()
        WHERE status = 'processing' AND gateway_ref IS NOT NULL AND expires_at < NOW()
        RETURNING id, order_id, restaurant_id`,
    );
    return result.rows;
};
