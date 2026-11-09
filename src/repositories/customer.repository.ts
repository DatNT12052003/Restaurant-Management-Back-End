import { db } from "~/config/db";
import {
    IFeedback,
    IFeedbackBody,
    ILoyaltyGuest,
    ILoyaltySettings,
    ILoyaltyTransaction,
    IOrderRequest,
    IOrderRequestItems,
    IPublicMenuItem,
    IPublicReservation,
    IPublicRestaurant,
    ITableOrderLine,
} from "~/interfaces";
import { OPEN_ORDER_STATUSES } from "./order.repository";

/** Giai đoạn 13: kênh khách hàng — thông tin công khai, xác minh đặt bàn, gọi món QR, điểm thưởng, phản hồi */

const TZ = "Asia/Ho_Chi_Minh";
const userName = (col: string, alias: string) => `(SELECT u.full_name FROM users u WHERE u.id = ${col}) AS ${alias}`;
const IS_GUEST = (alias: string) =>
    `EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${alias}.id AND ur.deleted_at IS NULL AND r.type_name = 'guest')`;

// ---------------------------------------------------------------------------
// Nhà hàng và thực đơn công khai
// ---------------------------------------------------------------------------

const RESTAURANT_PUBLIC = `r.id, r.name, r.address, r.phone, to_char(r.open_time, 'HH24:MI') AS open_time, to_char(r.close_time, 'HH24:MI') AS close_time,
    r.online_booking_enabled, r.online_booking_max_guests, r.online_booking_max_days, r.online_booking_lead_minutes, r.online_booking_minutes,
    (SELECT i.url FROM images i WHERE i.entity_type = 'restaurant' AND i.entity_id = r.id AND i.deleted_at IS NULL
        ORDER BY i.is_primary DESC, i.sort_order, i.id LIMIT 1) AS image_url`;

/** Chi nhánh đang hoạt động (không bị khóa) */
export const getPublicRestaurants = async (): Promise<IPublicRestaurant[]> => {
    const result = await db().query(
        `SELECT ${RESTAURANT_PUBLIC} FROM restaurants r WHERE r.deleted_at IS NULL AND r.status <> 'blocked' ORDER BY r.id`,
    );
    return result.rows;
};

export const getPublicRestaurant = async (id: number): Promise<(IPublicRestaurant & { qr_ordering_enabled: boolean }) | undefined> => {
    const result = await db().query(
        `SELECT ${RESTAURANT_PUBLIC}, r.qr_ordering_enabled FROM restaurants r WHERE r.id = $1 AND r.deleted_at IS NULL AND r.status <> 'blocked'`,
        [id],
    );
    return result.rows[0];
};

export const getRestaurantImages = async (id: number): Promise<string[]> => {
    const result = await db().query(
        "SELECT url FROM images WHERE entity_type = 'restaurant' AND entity_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, sort_order, id",
        [id],
    );
    return result.rows.map((r) => r.url);
};

const image = (type: string, alias: string) => `(SELECT i.url FROM images i WHERE i.entity_type = '${type}' AND i.entity_id = ${alias}.id
    AND i.deleted_at IS NULL ORDER BY i.is_primary DESC, i.sort_order, i.id LIMIT 1) AS image_url`;

/** Món / combo đang bán ở chi nhánh, giá thực tế của chi nhánh */
export const getPublicMenu = async (restaurantId: number): Promise<{ dishes: IPublicMenuItem[]; combos: IPublicMenuItem[] }> => {
    const [dishes, combos] = await Promise.all([
        db().query(
            `SELECT d.id, 'dish' AS kind, d.name, d.description, d.category, COALESCE(rd.price, d.price) AS price, ${image("dish", "d")},
                COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                    FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id AND t.deleted_at IS NULL WHERE dt.dish_id = d.id), '[]'::json) AS tags
            FROM dishes d LEFT JOIN restaurant_dishes rd ON rd.dish_id = d.id AND rd.restaurant_id = $1
            WHERE d.deleted_at IS NULL AND d.status = 'active' AND COALESCE(rd.is_available, true)
            ORDER BY d.category, lower(d.name)`,
            [restaurantId],
        ),
        db().query(
            `SELECT c.id, 'combo' AS kind, c.name, c.description, NULL AS category, COALESCE(rc.price, c.price) AS price, ${image("combo", "c")},
                '[]'::json AS tags,
                COALESCE((SELECT json_agg(json_build_object('name', dd.name, 'quantity', ci.quantity) ORDER BY dd.name)
                    FROM combo_items ci JOIN dishes dd ON dd.id = ci.dish_id WHERE ci.combo_id = c.id), '[]'::json) AS items
            FROM combos c LEFT JOIN restaurant_combos rc ON rc.combo_id = c.id AND rc.restaurant_id = $1
            WHERE c.deleted_at IS NULL AND c.status = 'active' AND COALESCE(rc.is_available, true)
            ORDER BY lower(c.name)`,
            [restaurantId],
        ),
    ]);
    return { dishes: dishes.rows, combos: combos.rows };
};

export const isClosedDay = async (restaurantId: number, day: string): Promise<boolean> => {
    const result = await db().query("SELECT 1 FROM restaurant_closed_days WHERE restaurant_id = $1 AND day = $2::date", [restaurantId, day]);
    return result.rows.length > 0;
};

// ---------------------------------------------------------------------------
// Xác minh email khi đặt bàn
// ---------------------------------------------------------------------------

export const countRecentVerifications = async (email: string, minutes: number): Promise<number> => {
    const result = await db().query(
        "SELECT COUNT(*)::int AS n FROM booking_verifications WHERE lower(email) = lower($1) AND created_at > NOW() - make_interval(mins => $2)",
        [email, minutes],
    );
    return result.rows[0].n;
};

export const createVerification = async (email: string, hash: string, expiresAt: Date, ip: string | null): Promise<void> => {
    await db().query("INSERT INTO booking_verifications (email, hash_code, expires_at, ip) VALUES ($1, $2, $3, $4)", [email, hash, expiresAt, ip]);
};

/** Mã còn hiệu lực mới nhất của email (khóa dòng) */
export const getActiveVerification = async (email: string): Promise<{ id: number; hash_code: string; attempts: number } | undefined> => {
    const result = await db().query(
        `SELECT id, hash_code, attempts FROM booking_verifications
        WHERE lower(email) = lower($1) AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [email],
    );
    return result.rows[0];
};

export const bumpVerificationAttempts = async (id: number): Promise<void> => {
    await db().query("UPDATE booking_verifications SET attempts = attempts + 1 WHERE id = $1", [id]);
};

export const useVerification = async (id: number): Promise<void> => {
    await db().query("UPDATE booking_verifications SET used_at = NOW() WHERE id = $1", [id]);
};

// ---------------------------------------------------------------------------
// Đặt bàn online
// ---------------------------------------------------------------------------

const PUBLIC_RESERVATION = `SELECT rv.lookup_code, rv.restaurant_id, r.name AS restaurant_name, r.address AS restaurant_address, r.phone AS restaurant_phone,
        rv.contact_name, rv.contact_phone, rv.guest_count, rv.start_time, rv.end_time, rv.status, rv.note, rv.cancel_reason, rv.created_at,
        rv.id, rv.contact_email, rv.source, rv.guest_user_id
    FROM reservations rv JOIN restaurants r ON r.id = rv.restaurant_id`;

type FullReservation = IPublicReservation & { id: number; contact_email: string | null; source: string; guest_user_id: number | null };

export const getReservationByCode = async (code: string, forUpdate = false): Promise<FullReservation | undefined> => {
    const result = await db().query(
        `${PUBLIC_RESERVATION} WHERE upper(rv.lookup_code) = upper($1) AND rv.deleted_at IS NULL${forUpdate ? " FOR UPDATE OF rv" : ""}`,
        [code],
    );
    return result.rows[0];
};

export const getPublicReservationById = async (id: number): Promise<FullReservation | undefined> => {
    return (await db().query(`${PUBLIC_RESERVATION} WHERE rv.id = $1`, [id])).rows[0];
};

export const setReservationOnline = async (id: number, payload: { lookup_code: string; contact_email: string | null }): Promise<void> => {
    await db().query("UPDATE reservations SET source = 'online', lookup_code = $2, contact_email = $3 WHERE id = $1", [
        id,
        payload.lookup_code,
        payload.contact_email,
    ]);
};

export const getGuestReservations = async (userId: number): Promise<FullReservation[]> => {
    const result = await db().query(`${PUBLIC_RESERVATION} WHERE rv.guest_user_id = $1 AND rv.deleted_at IS NULL ORDER BY rv.start_time DESC LIMIT 100`, [userId]);
    return result.rows;
};

// ---------------------------------------------------------------------------
// Bàn và gọi món QR
// ---------------------------------------------------------------------------

export const getTableByToken = async (
    token: string,
): Promise<{ id: number; name: string; status: string; room_name: string; restaurant_id: number; restaurant_name: string; qr_ordering_enabled: boolean } | undefined> => {
    const result = await db().query(
        `SELECT t.id, t.name, t.status, rm.name AS room_name, rm.restaurant_id, r.name AS restaurant_name, r.qr_ordering_enabled
        FROM tables t JOIN rooms rm ON rm.id = t.room_id AND rm.deleted_at IS NULL
        JOIN restaurants r ON r.id = rm.restaurant_id AND r.deleted_at IS NULL AND r.status <> 'blocked'
        WHERE t.qr_token = $1 AND t.deleted_at IS NULL`,
        [token],
    );
    return result.rows[0];
};

export const rotateTableToken = async (tableId: number): Promise<string | undefined> => {
    const result = await db().query(
        "UPDATE tables SET qr_token = substr(md5(random()::text || clock_timestamp()::text), 1, 24), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING qr_token",
        [tableId],
    );
    return result.rows[0]?.qr_token;
};

/** Các món của order (tên, số lượng, trạng thái, giá) để khách xem ở bàn */
export const getOrderLines = async (orderId: number): Promise<ITableOrderLine[]> => {
    const result = await db().query(
        `SELECT 'dish' AS kind, d.name, oi.quantity, oi.status, oi.current_price AS price, oi.id FROM order_items oi JOIN dishes d ON d.id = oi.dish_id
            WHERE oi.order_id = $1 AND oi.status <> 'cancelled'
        UNION ALL
        SELECT 'combo', c.name, oc.quantity, oc.status, oc.current_price, oc.id FROM order_combos oc JOIN combos c ON c.id = oc.combo_id
            WHERE oc.order_id = $1 AND oc.status <> 'cancelled'
        ORDER BY id`,
        [orderId],
    );
    return result.rows.map(({ id, ...line }) => line);
};

export const getOrderBrief = async (orderId: number): Promise<{ id: number; code: string; total: string } | undefined> => {
    return (await db().query("SELECT id, code, total FROM orders WHERE id = $1", [orderId])).rows[0];
};

/** Order vừa hoàn tất ở bàn trong `hours` giờ qua, chưa có phản hồi */
export const getRecentCompletedOrderAtTable = async (tableId: number, hours: number): Promise<{ id: number; code: string; completed_at: Date } | undefined> => {
    const result = await db().query(
        `SELECT o.id, o.code, o.completed_at FROM orders o JOIN order_tables ot ON ot.order_id = o.id AND ot.table_id = $1
        WHERE o.status = 'completed' AND o.completed_at > NOW() - make_interval(hours => $2)
            AND NOT EXISTS (SELECT 1 FROM order_feedbacks f WHERE f.order_id = o.id)
        ORDER BY o.completed_at DESC LIMIT 1`,
        [tableId, hours],
    );
    return result.rows[0];
};

export const countPendingRequests = async (tableId: number): Promise<number> => {
    const result = await db().query("SELECT COUNT(*)::int AS n FROM order_requests WHERE table_id = $1 AND status = 'pending'", [tableId]);
    return result.rows[0].n;
};

export const createOrderRequest = async (payload: {
    restaurant_id: number;
    table_id: number;
    guest_user_id: number | null;
    client_token: string;
    guest_count: number | null;
    items: IOrderRequestItems;
    note: string | null;
    ip: string | null;
}): Promise<{ id: number }> => {
    const result = await db().query(
        `INSERT INTO order_requests (restaurant_id, table_id, guest_user_id, client_token, guest_count, items, note, ip)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [payload.restaurant_id, payload.table_id, payload.guest_user_id, payload.client_token, payload.guest_count, JSON.stringify(payload.items), payload.note, payload.ip],
    );
    return result.rows[0];
};

const REQUEST_SELECT = `SELECT q.*, t.name AS table_name, rm.name AS room_name, o.code AS order_code,
        ${userName("q.guest_user_id", "guest_name")}, ${userName("q.decided_by", "decided_by_name")}
    FROM order_requests q JOIN tables t ON t.id = q.table_id JOIN rooms rm ON rm.id = t.room_id
    LEFT JOIN orders o ON o.id = q.order_id`;

export const getOrderRequests = async (filter: {
    restaurantId?: number | null;
    status?: string;
    tableId?: number;
    clientToken?: string;
    limit?: number;
}): Promise<IOrderRequest[]> => {
    const result = await db().query(
        `${REQUEST_SELECT}
        WHERE ($1::int IS NULL OR q.restaurant_id = $1::int) AND ($2::text IS NULL OR q.status = $2)
            AND ($3::int IS NULL OR q.table_id = $3::int) AND ($4::text IS NULL OR q.client_token = $4)
        ORDER BY q.created_at DESC LIMIT $5`,
        [filter.restaurantId ?? null, filter.status ?? null, filter.tableId ?? null, filter.clientToken ?? null, filter.limit ?? 100],
    );
    return result.rows;
};

export const getOrderRequestById = async (id: number, forUpdate = false): Promise<IOrderRequest | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM order_requests WHERE id = $1 FOR UPDATE", [id]);
    return (await db().query(`${REQUEST_SELECT} WHERE q.id = $1`, [id])).rows[0];
};

export const updateOrderRequest = async (
    id: number,
    payload: { status: string; order_id?: number | null; round_id?: number | null; reject_reason?: string | null; decided_by: number | null },
): Promise<void> => {
    await db().query(
        `UPDATE order_requests SET status = $2, order_id = COALESCE($3, order_id), round_id = COALESCE($4, round_id), reject_reason = $5,
            decided_by = $6, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id, payload.status, payload.order_id ?? null, payload.round_id ?? null, payload.reject_reason ?? null, payload.decided_by],
    );
};

/** Tên và giá (hiện tại của chi nhánh) của các món trong yêu cầu */
export const getItemNames = async (
    restaurantId: number,
    dishIds: number[],
    comboIds: number[],
): Promise<{ dishes: Map<number, { name: string; price: string }>; combos: Map<number, { name: string; price: string }> }> => {
    const [d, c] = await Promise.all([
        db().query(
            `SELECT d.id, d.name, COALESCE(rd.price, d.price) AS price FROM dishes d
            LEFT JOIN restaurant_dishes rd ON rd.dish_id = d.id AND rd.restaurant_id = $1 WHERE d.id = ANY($2::int[])`,
            [restaurantId, dishIds],
        ),
        db().query(
            `SELECT c.id, c.name, COALESCE(rc.price, c.price) AS price FROM combos c
            LEFT JOIN restaurant_combos rc ON rc.combo_id = c.id AND rc.restaurant_id = $1 WHERE c.id = ANY($2::int[])`,
            [restaurantId, comboIds],
        ),
    ]);
    return {
        dishes: new Map(d.rows.map((r) => [r.id, { name: r.name, price: r.price }])),
        combos: new Map(c.rows.map((r) => [r.id, { name: r.name, price: r.price }])),
    };
};

/** Lấy lượt gọi món (round) mới nhất của order */
export const getLatestRoundId = async (orderId: number): Promise<number | undefined> => {
    return (await db().query("SELECT id FROM order_rounds WHERE order_id = $1 ORDER BY round_no DESC LIMIT 1", [orderId])).rows[0]?.id;
};

// ---------------------------------------------------------------------------
// Điểm thưởng
// ---------------------------------------------------------------------------

/** Cấu hình điểm thưởng (một dòng); chưa có thì tạo dòng mặc định */
export const getLoyaltySettings = async (): Promise<ILoyaltySettings> => {
    await db().query("INSERT INTO loyalty_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    const result = await db().query(
        "SELECT enabled, earn_amount, point_value, max_redeem_percent, regular_visit_count, regular_window_months, updated_at FROM loyalty_settings WHERE id = 1",
    );
    return result.rows[0];
};

export const updateLoyaltySettings = async (body: Partial<ILoyaltySettings>, userId: number | null): Promise<ILoyaltySettings> => {
    const fields = ["enabled", "earn_amount", "point_value", "max_redeem_percent", "regular_visit_count", "regular_window_months"] as const;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
        if (body[f] !== undefined) {
            values.push(body[f]);
            sets.push(`${f} = $${values.length}`);
        }
    }
    values.push(userId);
    sets.push(`updated_by = $${values.length}`, "updated_at = NOW()");
    await db().query(`UPDATE loyalty_settings SET ${sets.join(", ")} WHERE id = 1`, values);
    return getLoyaltySettings();
};

const GUEST_SELECT = (reservedExclude = "0") => `SELECT u.id, u.full_name, u.phone_number, u.email, u.guest_status, u.loyalty_points,
        u.loyalty_points - COALESCE((SELECT SUM(o.points_redeemed) FROM orders o
            WHERE o.guest_user_id = u.id AND o.status = ANY('{${OPEN_ORDER_STATUSES.join(",")}}'::text[]) AND o.id <> ${reservedExclude}), 0)::int AS available_points
    FROM users u WHERE u.deleted_at IS NULL AND ${IS_GUEST("u")}`;

/** Tìm khách theo SĐT / email / tên (tối đa 20) */
export const searchGuests = async (q: string): Promise<ILoyaltyGuest[]> => {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const result = await db().query(
        `${GUEST_SELECT()} AND (u.phone_number ILIKE $1 OR u.email ILIKE $1 OR u.full_name ILIKE $1) ORDER BY u.full_name LIMIT 20`,
        [like],
    );
    return result.rows;
};

/** `excludeOrderId`: điểm đang giữ ở order này không trừ vào số dùng được */
export const getLoyaltyGuest = async (userId: number, excludeOrderId = 0, forUpdate = false): Promise<ILoyaltyGuest | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const result = await db().query(`${GUEST_SELECT(String(Number(excludeOrderId) || 0))} AND u.id = $1`, [userId]);
    return result.rows[0];
};

/** Cộng / trừ điểm và ghi sổ. Trả về số dư mới. Gọi sau khi đã khóa dòng user. */
export const addLoyaltyTransaction = async (payload: {
    user_id: number;
    order_id?: number | null;
    type: string;
    points: number;
    note?: string | null;
    created_by?: number | null;
}): Promise<number> => {
    const balance = (
        await db().query("UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1 RETURNING loyalty_points", [payload.user_id, payload.points])
    ).rows[0].loyalty_points as number;
    await db().query(
        "INSERT INTO loyalty_transactions (user_id, order_id, type, points, balance_after, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [payload.user_id, payload.order_id ?? null, payload.type, payload.points, balance, payload.note ?? null, payload.created_by ?? null],
    );
    return balance;
};

export const getLoyaltyTransactions = async (userId: number, limit = 100): Promise<ILoyaltyTransaction[]> => {
    const result = await db().query(
        `SELECT lt.*, o.code AS order_code, ${userName("lt.created_by", "created_by_name")}
        FROM loyalty_transactions lt LEFT JOIN orders o ON o.id = lt.order_id
        WHERE lt.user_id = $1 ORDER BY lt.created_at DESC, lt.id DESC LIMIT $2`,
        [userId, limit],
    );
    return result.rows;
};

/** Điểm đã trừ lại (hoàn tiền) của một order */
export const getRevokedPoints = async (orderId: number): Promise<number> => {
    const result = await db().query("SELECT COALESCE(-SUM(points), 0)::int AS n FROM loyalty_transactions WHERE order_id = $1 AND type = 'revoke'", [orderId]);
    return result.rows[0].n;
};

export const countCompletedVisits = async (userId: number, months: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS n FROM orders WHERE guest_user_id = $1 AND status = 'completed' AND deleted_at IS NULL
            AND completed_at > NOW() - make_interval(months => $2)`,
        [userId, months],
    );
    return result.rows[0].n;
};

export const setGuestRegular = async (userId: number): Promise<boolean> => {
    const result = await db().query(
        "UPDATE users SET guest_status = 'regular', updated_at = NOW() WHERE id = $1 AND COALESCE(guest_status, 'new') <> 'regular' RETURNING id",
        [userId],
    );
    return result.rows.length > 0;
};

// ---------------------------------------------------------------------------
// Phản hồi
// ---------------------------------------------------------------------------

const FEEDBACK_SELECT = `SELECT f.*, o.code AS order_code, r.name AS restaurant_name, ${userName("f.guest_user_id", "guest_name")},
        ${userName("f.replied_by", "replied_by_name")}
    FROM order_feedbacks f JOIN orders o ON o.id = f.order_id JOIN restaurants r ON r.id = f.restaurant_id`;

export const createFeedback = async (payload: IFeedbackBody & { order_id: number; restaurant_id: number; guest_user_id: number | null }): Promise<{ id: number }> => {
    const result = await db().query(
        `INSERT INTO order_feedbacks (order_id, restaurant_id, guest_user_id, food_rating, service_rating, ambience_rating, comment, is_complaint, contact_phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
            payload.order_id,
            payload.restaurant_id,
            payload.guest_user_id,
            payload.food_rating,
            payload.service_rating,
            payload.ambience_rating,
            payload.comment ?? null,
            payload.is_complaint ?? false,
            payload.contact_phone ?? null,
        ],
    );
    return result.rows[0];
};

export const getFeedbackById = async (id: number): Promise<IFeedback | undefined> => {
    return (await db().query(`${FEEDBACK_SELECT} WHERE f.id = $1`, [id])).rows[0];
};

export const getFeedbackByOrder = async (orderId: number): Promise<IFeedback | undefined> => {
    return (await db().query(`${FEEDBACK_SELECT} WHERE f.order_id = $1`, [orderId])).rows[0];
};

export interface IFeedbackFilter {
    restaurantId: number | null;
    from: string;
    to: string;
    status?: string;
    complaintOnly?: boolean;
    maxRating?: number;
}

const feedbackWhere = `($1::int IS NULL OR f.restaurant_id = $1::int)
    AND f.created_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND f.created_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

export const getFeedbacks = async (filter: IFeedbackFilter, limit: number, offset: number): Promise<{ rows: IFeedback[]; total: number }> => {
    const result = await db().query(
        `${FEEDBACK_SELECT.replace("SELECT f.*", "SELECT f.*, COUNT(*) OVER() AS total_count")}
        WHERE ${feedbackWhere} AND ($4::text IS NULL OR f.status = $4) AND (NOT $5::boolean OR f.is_complaint)
            AND ($6::int IS NULL OR LEAST(f.food_rating, f.service_rating, f.ambience_rating) <= $6::int)
        ORDER BY f.created_at DESC, f.id DESC LIMIT $7 OFFSET $8`,
        [filter.restaurantId, filter.from, filter.to, filter.status ?? null, !!filter.complaintOnly, filter.maxRating ?? null, limit, offset],
    );
    const total = Number(result.rows[0]?.total_count ?? 0);
    return { rows: result.rows.map(({ total_count, ...row }) => row), total };
};

export const getFeedbackSummary = async (filter: IFeedbackFilter) => {
    const [totals, byRestaurant] = await Promise.all([
        db().query(
            `SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE f.is_complaint)::int AS complaints,
                COUNT(*) FILTER (WHERE f.status <> 'resolved')::int AS open,
                ROUND(AVG(f.food_rating), 2)::float AS avg_food, ROUND(AVG(f.service_rating), 2)::float AS avg_service,
                ROUND(AVG(f.ambience_rating), 2)::float AS avg_ambience
            FROM order_feedbacks f WHERE ${feedbackWhere}`,
            [filter.restaurantId, filter.from, filter.to],
        ),
        db().query(
            `SELECT f.restaurant_id, r.name AS restaurant_name, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE f.is_complaint)::int AS complaints,
                ROUND(AVG((f.food_rating + f.service_rating + f.ambience_rating) / 3.0), 2)::float AS avg_overall
            FROM order_feedbacks f JOIN restaurants r ON r.id = f.restaurant_id WHERE ${feedbackWhere}
            GROUP BY f.restaurant_id, r.name ORDER BY r.name`,
            [filter.restaurantId, filter.from, filter.to],
        ),
    ]);
    return { ...totals.rows[0], by_restaurant: byRestaurant.rows };
};

export const updateFeedback = async (id: number, payload: { status?: string; reply?: string | null; replied_by?: number | null }): Promise<void> => {
    await db().query(
        `UPDATE order_feedbacks SET status = COALESCE($2, status),
            reply = CASE WHEN $3::boolean THEN $4 ELSE reply END,
            replied_by = CASE WHEN $3::boolean THEN $5 ELSE replied_by END,
            replied_at = CASE WHEN $3::boolean THEN NOW() ELSE replied_at END,
            updated_at = NOW() WHERE id = $1`,
        [id, payload.status ?? null, payload.reply !== undefined, payload.reply ?? null, payload.replied_by ?? null],
    );
};

// ---------------------------------------------------------------------------
// Tài khoản khách
// ---------------------------------------------------------------------------

export const getCustomerStats = async (userId: number): Promise<{ visits: number; total_spent: string }> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS visits, COALESCE(SUM(o.total), 0) AS total_spent FROM orders o
        WHERE o.guest_user_id = $1 AND o.status = 'completed' AND o.deleted_at IS NULL`,
        [userId],
    );
    return result.rows[0];
};

export const getCustomerOrders = async (userId: number) => {
    const result = await db().query(
        `SELECT o.id, o.code, o.restaurant_id, r.name AS restaurant_name, o.status, o.total, o.points_redeemed, o.points_awarded,
            o.created_at, o.completed_at
        FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.guest_user_id = $1 AND o.deleted_at IS NULL AND o.status <> 'merged'
        ORDER BY o.created_at DESC LIMIT 100`,
        [userId],
    );
    return result.rows as { id: number; code: string; restaurant_id: number; restaurant_name: string; status: string; total: string; points_redeemed: number; points_awarded: number; created_at: Date; completed_at: Date | null }[];
};

/** Order của khách (để đánh giá) */
export const getOrderForFeedback = async (orderId: number): Promise<{ id: number; restaurant_id: number; guest_user_id: number | null; status: string; completed_at: Date | null } | undefined> => {
    return (await db().query("SELECT id, restaurant_id, guest_user_id, status, completed_at FROM orders WHERE id = $1 AND deleted_at IS NULL", [orderId])).rows[0];
};

export const isGuestUser = async (userId: number): Promise<boolean> => {
    const result = await db().query(`SELECT 1 FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND ${IS_GUEST("u")}`, [userId]);
    return result.rows.length > 0;
};

export const getTableRestaurant = async (tableId: number): Promise<{ id: number; restaurant_id: number } | undefined> => {
    const result = await db().query(
        "SELECT t.id, rm.restaurant_id FROM tables t JOIN rooms rm ON rm.id = t.room_id WHERE t.id = $1 AND t.deleted_at IS NULL",
        [tableId],
    );
    return result.rows[0];
};
