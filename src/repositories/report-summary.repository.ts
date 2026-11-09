import { db } from "~/config/db";

/**
 * Giai đoạn 14: bảng tổng hợp tiền thu / hoàn theo ngày (giờ VN), nhà hàng, phương thức, cho báo cáo dài ngày.
 * - `report_summary_state.payments_through`: ngày cuối đã tổng hợp. Trigger trên `payments` lùi mốc khi có thay đổi
 *   rơi vào ngày đã tổng hợp, nên phần sau mốc luôn đọc thẳng từ `payments` (luôn đúng, kể cả trước khi job chạy).
 * - Dùng chung điều kiện "có hiệu lực" với report.repository: thu (paid / refunded) cộng, hoàn (paid) trừ.
 */

const TZ = "Asia/Ho_Chi_Minh";

const SETTLED = `((p.type = 'payment' AND p.status IN ('paid', 'refunded')) OR (p.type = 'refund' AND p.status = 'paid'))`;
const COLLECTED = `COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'payment' AND p.status IN ('paid', 'refunded')), 0)`;
const REFUNDED = `COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'refund' AND p.status = 'paid'), 0)`;
const PAYMENT_COUNT = `COUNT(*) FILTER (WHERE p.type = 'payment')`;
const TIPS = `COALESCE(SUM(p.tip_amount) FILTER (WHERE p.type = 'payment' AND p.status IN ('paid', 'refunded')), 0)`;

/**
 * Nguồn dữ liệu theo ngày cho khoảng [$1, $2] và nhà hàng $3 (NULL = cả chuỗi): ngày đã tổng hợp đọc từ bảng tổng hợp,
 * phần còn lại tính từ `payments`. Cột: day, restaurant_id, method, collected, refunded, payment_count.
 * Dùng làm CTE: `WITH paid_daily AS (${PAID_DAILY_SQL}) ...`
 */
export const PAID_DAILY_SQL = `
    SELECT s.day, s.restaurant_id, s.method, s.collected, s.refunded, s.payment_count
    FROM report_daily_payments s
    CROSS JOIN (SELECT (SELECT payments_through FROM report_summary_state WHERE id = 1) AS through) st
    WHERE st.through IS NOT NULL AND s.day >= $1::date AND s.day <= LEAST($2::date, st.through)
        AND ($3::int IS NULL OR s.restaurant_id = $3::int)
    UNION ALL
    SELECT (p.paid_at AT TIME ZONE '${TZ}')::date AS day, p.restaurant_id, p.method,
        ${COLLECTED} AS collected, ${REFUNDED} AS refunded, ${PAYMENT_COUNT} AS payment_count
    FROM payments p
    CROSS JOIN (SELECT (SELECT payments_through FROM report_summary_state WHERE id = 1) AS through) st
    WHERE ${SETTLED}
        AND p.paid_at >= (($1::date)::timestamp AT TIME ZONE '${TZ}')
        AND p.paid_at < ((($2::date) + 1)::timestamp AT TIME ZONE '${TZ}')
        AND (st.through IS NULL OR p.paid_at >= (((st.through) + 1)::timestamp AT TIME ZONE '${TZ}'))
        AND ($3::int IS NULL OR p.restaurant_id = $3::int)
    GROUP BY 1, 2, 3
`;

/**
 * Tổng hợp các ngày từ sau mốc đến hôm qua (giờ VN). Gọi trong transaction.
 * Trả về số ngày đã tổng hợp thêm (0 nếu đã cập nhật).
 */
export const refreshDailyPayments = async (): Promise<{ from: string | null; through: string; days: number }> => {
    await db().query("INSERT INTO report_summary_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    const state = await db().query(
        `SELECT payments_through::text AS through, ((now() AT TIME ZONE '${TZ}')::date - 1)::text AS yesterday,
            (SELECT MIN((paid_at AT TIME ZONE '${TZ}')::date)::text FROM payments WHERE paid_at IS NOT NULL) AS first_day
        FROM report_summary_state WHERE id = 1 FOR UPDATE`,
    );
    const { through, yesterday, first_day } = state.rows[0] as { through: string | null; yesterday: string; first_day: string | null };
    if (through && through >= yesterday) return { from: null, through, days: 0 };

    // Lần đầu: bắt đầu từ payment sớm nhất; không có payment nào thì chỉ đặt mốc
    const from = through ?? first_day;
    await db().query("DELETE FROM report_daily_payments WHERE ($1::date IS NULL OR day > $1::date)", [through]);
    if (from) {
        await db().query(
            `INSERT INTO report_daily_payments (day, restaurant_id, method, collected, refunded, payment_count, tips)
            SELECT (p.paid_at AT TIME ZONE '${TZ}')::date, p.restaurant_id, p.method,
                ${COLLECTED}, ${REFUNDED}, ${PAYMENT_COUNT}, ${TIPS}
            FROM payments p
            WHERE ${SETTLED}
                AND ($1::date IS NULL OR p.paid_at >= ((($1::date) + 1)::timestamp AT TIME ZONE '${TZ}'))
                AND p.paid_at < ((($2::date) + 1)::timestamp AT TIME ZONE '${TZ}')
            GROUP BY 1, 2, 3`,
            [through, yesterday],
        );
    }
    await db().query("UPDATE report_summary_state SET payments_through = $1::date, refreshed_at = NOW() WHERE id = 1", [
        yesterday,
    ]);
    const days = from ? Math.max(0, Math.round((Date.parse(yesterday) - Date.parse(from)) / 86_400_000) + (through ? 0 : 1)) : 0;
    return { from, through: yesterday, days };
};

export const getState = async (): Promise<{ payments_through: string | null; refreshed_at: Date | null }> => {
    const result = await db().query(
        "SELECT payments_through::text AS payments_through, refreshed_at FROM report_summary_state WHERE id = 1",
    );
    return result.rows[0] ?? { payments_through: null, refreshed_at: null };
};
