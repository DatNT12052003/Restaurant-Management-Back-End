import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IEInvoice, ISelectQuery } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery } from "~/utils/query-builder";

/** Giai đoạn 14: hóa đơn điện tử. Mỗi order tối đa một hóa đơn chưa hủy (index `e_invoices_order_active`). */

const WRITABLE_FIELDS = [
    "order_id",
    "restaurant_id",
    "provider",
    "status",
    "source",
    "buyer_type",
    "buyer_name",
    "buyer_company",
    "buyer_tax_code",
    "buyer_address",
    "buyer_email",
    "buyer_phone",
    "seller",
    "lines",
    "amount_before_tax",
    "tax_rate",
    "tax_amount",
    "total",
    "series",
    "invoice_no",
    "lookup_code",
    "lookup_url",
    "provider_ref",
    "issued_at",
    "attempts",
    "next_retry_at",
    "error_message",
    "cancelled_at",
    "cancelled_by",
    "cancel_reason",
    "created_by",
];

const RETURNING = [
    "e.*",
    "(SELECT o.code FROM orders o WHERE o.id = e.order_id) AS order_code",
    "(SELECT r.name FROM restaurants r WHERE r.id = e.restaurant_id) AS restaurant_name",
    "(SELECT u.full_name FROM users u WHERE u.id = e.created_by) AS created_by_name",
];

const FIELD_MAP: Record<string, string> = {
    restaurant_id: "e.restaurant_id",
    order_id: "e.order_id",
    status: "e.status",
    source: "e.source",
    created_at: "e.created_at",
    issued_at: "e.issued_at",
    total: "e.total",
};

const SEARCH_FIELDS = ["e.invoice_no", "e.buyer_name", "e.buyer_company", "e.buyer_tax_code", "o.code"];

export const getEInvoices = async (params: ISelectQuery): Promise<{ rows: IEInvoice[]; totalCount: number }> => {
    const orderBy = (params.orderBy || []).map((o) => ({ ...o, field: FIELD_MAP[o.field] })).filter((o) => o.field);
    const { query, values } = buildSelectAllQuery("e_invoices e", [...Object.values(FIELD_MAP), ...SEARCH_FIELDS], {
        ...params,
        filters: (params.filters || []).map((f) => ({ ...f, field: FIELD_MAP[f.field] })).filter((f) => f.field),
        orderBy: orderBy.length ? orderBy : [{ field: "e.created_at", direction: OrderTypeEnum.DESC }],
        search: params.search?.text ? { text: params.search.text, fields: SEARCH_FIELDS } : undefined,
        joins: [{ table: "orders o", on: "o.id = e.order_id" }],
        returning: RETURNING,
        noSoftDelete: true,
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

export const getEInvoiceById = async (id: number, forUpdate = false): Promise<IEInvoice | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM e_invoices WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${RETURNING.join(", ")} FROM e_invoices e WHERE e.id = $1`, [id]);
    return result.rows[0];
};

/** Hóa đơn còn hiệu lực (chưa hủy) của order */
export const getActiveByOrder = async (orderId: number): Promise<IEInvoice | undefined> => {
    const result = await db().query(
        `SELECT ${RETURNING.join(", ")} FROM e_invoices e WHERE e.order_id = $1 AND e.status <> 'cancelled'`,
        [orderId],
    );
    return result.rows[0];
};

export const createEInvoice = async (row: Partial<Record<string, unknown>>): Promise<{ id: number }> => {
    const data = { ...row, seller: JSON.stringify(row.seller), lines: JSON.stringify(row.lines) };
    const { query, values } = buildInsertQuery("e_invoices", data, WRITABLE_FIELDS, ["id"]);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateEInvoice = async (id: number, row: Partial<Record<string, unknown>>): Promise<void> => {
    const entries = Object.entries(row).filter(([k, v]) => WRITABLE_FIELDS.includes(k) && v !== undefined);
    if (!entries.length) return;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    await db().query(`UPDATE e_invoices SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, [
        id,
        ...entries.map(([, v]) => v),
    ]);
};

/**
 * Nhận một hóa đơn để gửi: tăng số lần thử và tạm đẩy lịch thử lại (để job khác không gửi trùng).
 * Trả về undefined nếu hóa đơn không còn chờ gửi hoặc đang được gửi.
 */
export const claimForDispatch = async (id: number): Promise<IEInvoice | undefined> => {
    const result = await db().query(
        `UPDATE e_invoices SET attempts = attempts + 1, next_retry_at = NOW() + interval '5 minutes', updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        RETURNING id`,
        [id],
    );
    if (!result.rowCount) return undefined;
    return getEInvoiceById(id);
};

/** Hóa đơn đến lượt gửi (job mỗi phút) */
export const getDueIds = async (maxAttempts: number, limit = 20): Promise<number[]> => {
    const result = await db().query(
        `SELECT id FROM e_invoices
        WHERE status IN ('pending', 'failed') AND attempts < $1 AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        ORDER BY id LIMIT $2`,
        [maxAttempts, limit],
    );
    return result.rows.map((r) => r.id);
};

/** Số tiếp theo của một ký hiệu (dùng cho nhà cung cấp giả lập) */
export const nextMockNumber = async (series: string): Promise<number> => {
    const result = await db().query(
        `SELECT COALESCE(MAX(invoice_no::int), 0) + 1 AS next FROM e_invoices
        WHERE series = $1 AND provider = 'mock' AND invoice_no ~ '^[0-9]+$'`,
        [series],
    );
    return Number(result.rows[0].next);
};

