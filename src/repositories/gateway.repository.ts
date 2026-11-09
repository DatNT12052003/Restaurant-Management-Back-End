import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { GatewayTransactionStatus, IGatewayTransaction, INormalizedTransfer, ISelectQuery } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

/**
 * Giai đoạn 14: giao dịch ngân hàng do cổng (SePay) báo về.
 * Duy nhất theo (provider, provider_txn_id): webhook gửi lại không tạo dòng mới.
 */

const RETURNING = [
    "g.id",
    "g.provider",
    "g.provider_txn_id",
    "g.restaurant_id",
    "(SELECT r.name FROM restaurants r WHERE r.id = g.restaurant_id) AS restaurant_name",
    "g.payment_id",
    "g.order_id",
    "(SELECT o.code FROM orders o WHERE o.id = g.order_id) AS order_code",
    "g.account_number",
    "g.amount",
    "g.content",
    "g.bank_reference",
    "g.matched_ref",
    "g.transaction_at",
    "g.status",
    "g.note",
    "g.resolved_by",
    "(SELECT u.full_name FROM users u WHERE u.id = g.resolved_by) AS resolved_by_name",
    "g.resolved_at",
    "g.created_at",
];

const FIELD_MAP: Record<string, string> = {
    restaurant_id: "g.restaurant_id",
    status: "g.status",
    created_at: "g.created_at",
    transaction_at: "g.transaction_at",
    amount: "g.amount",
    content: "g.content",
    bank_reference: "g.bank_reference",
};

const mapParams = (params: ISelectQuery): ISelectQuery => ({
    ...params,
    filters: (params.filters || []).map((f) => ({ ...f, field: FIELD_MAP[f.field] })).filter((f) => f.field),
    orderBy: (params.orderBy || []).map((o) => ({ ...o, field: FIELD_MAP[o.field] })).filter((o) => o.field),
    search: params.search?.text ? { text: params.search.text, fields: ["g.content", "g.bank_reference"] } : undefined,
});

export const getTransactions = async (params: ISelectQuery): Promise<{ rows: IGatewayTransaction[]; totalCount: number }> => {
    const mapped = mapParams(params);
    const { query, values } = buildSelectAllQuery("gateway_transactions g", Object.values(FIELD_MAP), {
        ...mapped,
        returning: RETURNING,
        noSoftDelete: true,
        orderBy: mapped.orderBy?.length ? mapped.orderBy : [{ field: "g.created_at", direction: OrderTypeEnum.DESC }],
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

/** Số giao dịch cần xử lý; `restaurantId` null = cả chuỗi (gồm giao dịch chưa xác định nhà hàng) */
export const countOpen = async (restaurantId: number | null): Promise<{ unmatched: number; mismatch: number }> => {
    const result = await db().query(
        `SELECT COUNT(*) FILTER (WHERE status = 'unmatched')::int AS unmatched,
            COUNT(*) FILTER (WHERE status = 'mismatch')::int AS mismatch
        FROM gateway_transactions WHERE status IN ('unmatched', 'mismatch')
            AND ($1::int IS NULL OR restaurant_id = $1::int)`,
        [restaurantId],
    );
    return result.rows[0];
};

export const getTransactionById = async (id: number, forUpdate = false): Promise<IGatewayTransaction | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM gateway_transactions WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${RETURNING.join(", ")} FROM gateway_transactions g WHERE g.id = $1`, [id]);
    return result.rows[0];
};

/** Ghi giao dịch mới; đã có (webhook gửi lại) thì trả về undefined */
export const insertTransaction = async (
    t: INormalizedTransfer,
    status: GatewayTransactionStatus,
): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        `INSERT INTO gateway_transactions
            (provider, provider_txn_id, account_number, amount, content, bank_reference, transaction_at, status, raw)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (provider, provider_txn_id) DO NOTHING
        RETURNING id`,
        [
            t.provider,
            t.provider_txn_id,
            t.account_number,
            t.amount,
            t.content,
            t.bank_reference,
            t.transaction_at,
            status,
            JSON.stringify(t.raw ?? null),
        ],
    );
    return result.rows[0];
};

export interface IGatewayTransactionUpdate {
    status?: GatewayTransactionStatus;
    restaurant_id?: number | null;
    payment_id?: number | null;
    order_id?: number | null;
    matched_ref?: string | null;
    note?: string | null;
    resolved_by?: number | null;
    resolved_at?: Date | null;
}

const UPDATABLE = ["status", "restaurant_id", "payment_id", "order_id", "matched_ref", "note", "resolved_by", "resolved_at"];

export const updateTransaction = async (id: number, row: IGatewayTransactionUpdate): Promise<void> => {
    const entries = Object.entries(row).filter(([k, v]) => UPDATABLE.includes(k) && v !== undefined);
    if (!entries.length) return;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    await db().query(`UPDATE gateway_transactions SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, [
        id,
        ...entries.map(([, v]) => v),
    ]);
};

/** Nhà hàng có tài khoản nhận này (chỉ trả về khi đúng một nhà hàng dùng tài khoản đó) */
export const getRestaurantByAccount = async (accountNo: string | null): Promise<number | null> => {
    if (!accountNo) return null;
    const result = await db().query(
        "SELECT id FROM restaurants WHERE deleted_at IS NULL AND bank_account_no = $1 LIMIT 2",
        [accountNo],
    );
    return result.rows.length === 1 ? result.rows[0].id : null;
};
