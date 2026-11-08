import { db } from "~/config/db";
import { IReportRange, ReportGroupBy } from "~/interfaces";

/**
 * Truy vấn báo cáo. Mọi mốc ngày tính theo giờ Việt Nam.
 * Tham số chung: $1 = từ ngày, $2 = đến ngày (gồm cả ngày này), $3 = nhà hàng (NULL = cả chuỗi).
 */
const TZ = "Asia/Ho_Chi_Minh";
const START = `(($1::date)::timestamp AT TIME ZONE '${TZ}')`;
const END = `((($2::date) + 1)::timestamp AT TIME ZONE '${TZ}')`;
const inRange = (col: string) => `${col} >= ${START} AND ${col} < ${END}`;
const ofRestaurant = (col: string) => `($3::int IS NULL OR ${col} = $3::int)`;
const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')`;

/** Tiền thực thu của payment: thu cộng, hoàn trừ */
const NET_AMOUNT = `CASE
    WHEN p.type = 'payment' AND p.status IN ('paid', 'refunded') THEN p.amount
    WHEN p.type = 'refund' AND p.status = 'paid' THEN -p.amount
    ELSE 0 END`;
const COLLECTED = `COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'payment' AND p.status IN ('paid', 'refunded')), 0)`;
const REFUNDED = `COALESCE(SUM(p.amount) FILTER (WHERE p.type = 'refund' AND p.status = 'paid'), 0)`;
/** Payment có hiệu lực (đã thu, hoặc là lần hoàn đã chi) */
const SETTLED = `((p.type = 'payment' AND p.status IN ('paid', 'refunded')) OR (p.type = 'refund' AND p.status = 'paid'))`;

const OPEN_ORDER = `('pending', 'confirmed', 'serving')`;

const args = (r: IReportRange) => [r.from, r.to, r.restaurantId];

/** Nhãn các kỳ trong khoảng (kể cả kỳ không có số liệu), dạng "YYYY-MM-DD" của ngày đầu kỳ */
export const getPeriods = async (r: IReportRange, groupBy: ReportGroupBy): Promise<string[]> => {
    const result = await db().query(
        `SELECT to_char(g, 'YYYY-MM-DD') AS period
        FROM generate_series(date_trunc($1::text, $2::date::timestamp), $3::date::timestamp, ('1 ' || $1::text)::interval) AS g`,
        [groupBy, r.from, r.to],
    );
    return result.rows.map((row) => row.period);
};

// ---------------------------------------------------------------------------
// Tổng quan
// ---------------------------------------------------------------------------

export const getTotals = async (r: IReportRange) => {
    const result = await db().query(
        `SELECT
            (SELECT COALESCE(SUM(${NET_AMOUNT}), 0) FROM payments p
                WHERE ${SETTLED} AND ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}) AS net_revenue,
            (SELECT ${COLLECTED} FROM payments p
                WHERE ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}) AS collected,
            (SELECT ${REFUNDED} FROM payments p
                WHERE ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}) AS refunded,
            o.completed_orders, o.gross_sales, o.discount_total, o.guests,
            (SELECT COUNT(*) FROM orders c WHERE c.deleted_at IS NULL AND c.status = 'cancelled'
                AND ${inRange("c.cancelled_at")} AND ${ofRestaurant("c.restaurant_id")}) AS cancelled_orders,
            rv.reservations, rv.reservations_no_show, rv.reservations_cancelled
        FROM
            (SELECT COUNT(*) AS completed_orders,
                COALESCE(SUM(total), 0) AS gross_sales,
                COALESCE(SUM(discount_amount), 0) AS discount_total,
                COALESCE(SUM(guest_count), 0) AS guests
            FROM orders WHERE deleted_at IS NULL AND status = 'completed'
                AND ${inRange("completed_at")} AND ${ofRestaurant("restaurant_id")}) o,
            (SELECT COUNT(*) AS reservations,
                COUNT(*) FILTER (WHERE status = 'no_show') AS reservations_no_show,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS reservations_cancelled
            FROM reservations WHERE deleted_at IS NULL
                AND ${inRange("start_time")} AND ${ofRestaurant("restaurant_id")}) rv`,
        args(r),
    );
    return result.rows[0];
};

export const getLive = async (restaurantId: number | null) => {
    const result = await db().query(
        `SELECT
            (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status IN ${OPEN_ORDER}
                AND ($1::int IS NULL OR restaurant_id = $1::int)) AS open_orders,
            (SELECT COUNT(*) FILTER (WHERE t.status = 'occupied') FROM tables t
                JOIN rooms r ON r.id = t.room_id AND r.deleted_at IS NULL
                WHERE t.deleted_at IS NULL AND ($1::int IS NULL OR r.restaurant_id = $1::int)) AS occupied_tables,
            (SELECT COUNT(*) FROM tables t
                JOIN rooms r ON r.id = t.room_id AND r.deleted_at IS NULL
                WHERE t.deleted_at IS NULL AND ($1::int IS NULL OR r.restaurant_id = $1::int)) AS total_tables,
            (SELECT COUNT(*) FROM reservations WHERE deleted_at IS NULL AND status IN ('pending', 'confirmed')
                AND start_time >= now()
                AND ${local("start_time")}::date = ${local("now()")}::date
                AND ($1::int IS NULL OR restaurant_id = $1::int)) AS upcoming_reservations_today,
            (SELECT COUNT(*) FROM inventory i JOIN ingredients g ON g.id = i.ingredient_id AND g.deleted_at IS NULL
                WHERE g.status = 'active' AND i.min_quantity > 0 AND i.quantity <= i.min_quantity
                AND ($1::int IS NULL OR i.restaurant_id = $1::int)) AS low_stock,
            (SELECT COALESCE(SUM(${NET_AMOUNT}), 0) FROM payments p
                WHERE ${SETTLED} AND ${local("p.paid_at")}::date = ${local("now()")}::date
                AND ($1::int IS NULL OR p.restaurant_id = $1::int)) AS today_net_revenue`,
        [restaurantId],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Doanh thu
// ---------------------------------------------------------------------------

/** Tiền thu / hoàn theo kỳ và nhà hàng (theo thời điểm thanh toán) */
export const getPaymentsByPeriod = async (r: IReportRange, groupBy: ReportGroupBy) => {
    const result = await db().query(
        `SELECT to_char(date_trunc($4::text, ${local("p.paid_at")}), 'YYYY-MM-DD') AS period, p.restaurant_id,
            ${COLLECTED} AS collected, ${REFUNDED} AS refunded
        FROM payments p
        WHERE ${SETTLED} AND ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}
        GROUP BY 1, 2`,
        [...args(r), groupBy],
    );
    return result.rows as { period: string; restaurant_id: number; collected: string; refunded: string }[];
};

/** Order hoàn tất theo kỳ và nhà hàng (theo thời điểm hoàn tất) */
export const getOrdersByPeriod = async (r: IReportRange, groupBy: ReportGroupBy) => {
    const result = await db().query(
        `SELECT to_char(date_trunc($4::text, ${local("completed_at")}), 'YYYY-MM-DD') AS period, restaurant_id,
            COUNT(*) AS orders, COALESCE(SUM(guest_count), 0) AS guests, COALESCE(SUM(total), 0) AS gross_sales
        FROM orders
        WHERE deleted_at IS NULL AND status = 'completed' AND ${inRange("completed_at")} AND ${ofRestaurant("restaurant_id")}
        GROUP BY 1, 2`,
        [...args(r), groupBy],
    );
    return result.rows as { period: string; restaurant_id: number; orders: string; guests: string; gross_sales: string }[];
};

export const getPaymentsByMethod = async (r: IReportRange) => {
    const result = await db().query(
        `SELECT p.method, ${COLLECTED} AS collected, ${REFUNDED} AS refunded,
            COUNT(*) FILTER (WHERE p.type = 'payment') AS count
        FROM payments p
        WHERE ${SETTLED} AND ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}
        GROUP BY p.method ORDER BY p.method`,
        args(r),
    );
    return result.rows as { method: string; collected: string; refunded: string; count: string }[];
};

/** Tên nhà hàng (gồm cả nhà hàng đã xóa vì vẫn có số liệu cũ) */
export const getRestaurantNames = async (ids: number[]): Promise<Record<number, string>> => {
    if (!ids.length) return {};
    const result = await db().query("SELECT id, name FROM restaurants WHERE id = ANY($1::int[])", [ids]);
    return Object.fromEntries(result.rows.map((row) => [row.id, row.name]));
};

// ---------------------------------------------------------------------------
// Món bán chạy
// ---------------------------------------------------------------------------

/** Theo order tạo trong khoảng, bỏ order đã hủy và dòng món đã hủy */
export const getTopDishes = async (r: IReportRange, limit: number, category: string | null) => {
    const result = await db().query(
        `SELECT d.id, d.name, d.category,
            SUM(i.quantity)::int AS quantity,
            SUM(i.quantity * i.current_price) AS revenue,
            COUNT(DISTINCT i.order_id)::int AS order_count
        FROM order_items i
        JOIN orders o ON o.id = i.order_id AND o.deleted_at IS NULL AND o.status <> 'cancelled'
        JOIN dishes d ON d.id = i.dish_id
        WHERE i.status <> 'cancelled' AND ${inRange("o.created_at")} AND ${ofRestaurant("o.restaurant_id")}
            AND ($5::text IS NULL OR d.category = $5::text)
        GROUP BY d.id, d.name, d.category
        ORDER BY quantity DESC, revenue DESC, d.id
        LIMIT $4`,
        [...args(r), limit, category],
    );
    return result.rows;
};

export const getTopCombos = async (r: IReportRange, limit: number) => {
    const result = await db().query(
        `SELECT c.id, c.name,
            SUM(i.quantity)::int AS quantity,
            SUM(i.quantity * i.current_price) AS revenue,
            COUNT(DISTINCT i.order_id)::int AS order_count
        FROM order_combos i
        JOIN orders o ON o.id = i.order_id AND o.deleted_at IS NULL AND o.status <> 'cancelled'
        JOIN combos c ON c.id = i.combo_id
        WHERE i.status <> 'cancelled' AND ${inRange("o.created_at")} AND ${ofRestaurant("o.restaurant_id")}
        GROUP BY c.id, c.name
        ORDER BY quantity DESC, revenue DESC, c.id
        LIMIT $4`,
        [...args(r), limit],
    );
    return result.rows;
};

// ---------------------------------------------------------------------------
// Lấp đầy bàn
// ---------------------------------------------------------------------------

/**
 * Các lượt ngồi bàn (`order_tables`) cắt theo khoảng [đầu khoảng, min(cuối khoảng, hiện tại)).
 * Chỉ tính bàn hiện còn (chưa xóa, thuộc phòng chưa xóa).
 */
const OCCUPANCY_CTE = `
    bounds AS (SELECT ${START} AS s, LEAST(${END}, now()) AS e),
    tbl AS (
        SELECT t.id, t.room_id, r.name AS room_name, r.restaurant_id
        FROM tables t JOIN rooms r ON r.id = t.room_id AND r.deleted_at IS NULL
        WHERE t.deleted_at IS NULL AND ${ofRestaurant("r.restaurant_id")}
    ),
    sess AS (
        SELECT tbl.id AS table_id, tbl.room_id, tbl.restaurant_id,
            GREATEST(ot.assigned_at, b.s) AS s, LEAST(COALESCE(ot.released_at, now()), b.e) AS e
        FROM order_tables ot JOIN tbl ON tbl.id = ot.table_id CROSS JOIN bounds b
        WHERE ot.assigned_at < b.e AND COALESCE(ot.released_at, now()) > b.s
    )`;

/** Số ngày đã qua trong khoảng (không tính ngày tương lai) */
export const getElapsedDays = async (r: IReportRange): Promise<number> => {
    const result = await db().query(
        `SELECT GREATEST(0, LEAST($2::date, ${local("now()")}::date) - $1::date + 1) AS days`,
        [r.from, r.to],
    );
    return Number(result.rows[0].days);
};

export const getOccupancyByRoom = async (r: IReportRange) => {
    const result = await db().query(
        `WITH ${OCCUPANCY_CTE}
        SELECT tbl.room_id, tbl.room_name, tbl.restaurant_id,
            COUNT(DISTINCT tbl.id)::int AS table_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM (sess.e - sess.s))) / 3600, 0) AS occupied_hours,
            COUNT(sess.table_id)::int AS sessions
        FROM tbl LEFT JOIN sess ON sess.table_id = tbl.id
        GROUP BY tbl.room_id, tbl.room_name, tbl.restaurant_id
        ORDER BY tbl.restaurant_id, tbl.room_name`,
        args(r),
    );
    return result.rows as {
        room_id: number;
        room_name: string;
        restaurant_id: number;
        table_count: number;
        occupied_hours: string;
        sessions: number;
    }[];
};

/** Giờ mở cửa của các nhà hàng trong phạm vi */
export const getRestaurantHours = async (restaurantId: number | null) => {
    const result = await db().query(
        `SELECT id, name, to_char(open_time, 'HH24:MI') AS open_time, to_char(close_time, 'HH24:MI') AS close_time,
            -- Đóng cửa <= mở cửa: mở qua đêm
            EXTRACT(EPOCH FROM (close_time - open_time + CASE WHEN close_time <= open_time THEN interval '24 hours' ELSE interval '0' END)) / 3600
                AS hours_per_day
        FROM restaurants WHERE deleted_at IS NULL AND ($1::int IS NULL OR id = $1::int) ORDER BY id`,
        [restaurantId],
    );
    return result.rows as { id: number; name: string; open_time: string; close_time: string; hours_per_day: string }[];
};

/** Số giờ-bàn có khách theo từng giờ trong ngày (0–23), cộng dồn cả khoảng */
export const getOccupancyByHour = async (r: IReportRange) => {
    const result = await db().query(
        `WITH ${OCCUPANCY_CTE},
        hours AS (
            SELECT h FROM bounds b, generate_series(date_trunc('hour', b.s), b.e - interval '1 microsecond', interval '1 hour') AS h
        )
        SELECT EXTRACT(HOUR FROM ${local("hours.h")})::int AS hour,
            SUM(EXTRACT(EPOCH FROM (LEAST(sess.e, hours.h + interval '1 hour') - GREATEST(sess.s, hours.h)))) / 3600 AS occupied_hours
        FROM hours JOIN sess ON sess.s < hours.h + interval '1 hour' AND sess.e > hours.h
        GROUP BY 1 ORDER BY 1`,
        args(r),
    );
    return result.rows as { hour: number; occupied_hours: string }[];
};

// ---------------------------------------------------------------------------
// Kho
// ---------------------------------------------------------------------------

export const getReceiptsByPeriod = async (r: IReportRange, groupBy: ReportGroupBy) => {
    const result = await db().query(
        `SELECT to_char(date_trunc($4::text, ${local("created_at")}), 'YYYY-MM-DD') AS period,
            COALESCE(SUM(total_value) FILTER (WHERE type = 'import'), 0) AS import_value,
            COALESCE(SUM(total_value) FILTER (WHERE type = 'export'), 0) AS export_value,
            COALESCE(SUM(total_value) FILTER (WHERE type = 'adjust'), 0) AS adjust_value,
            COUNT(*) AS receipts,
            COUNT(*) FILTER (WHERE type = 'import') AS import_receipts
        FROM inventory_receipts
        WHERE ${inRange("created_at")} AND ${ofRestaurant("restaurant_id")}
        GROUP BY 1`,
        [...args(r), groupBy],
    );
    return result.rows as {
        period: string;
        import_value: string;
        export_value: string;
        adjust_value: string;
        receipts: string;
        import_receipts: string;
    }[];
};

export const getTopImportedIngredients = async (r: IReportRange, limit: number) => {
    const result = await db().query(
        `SELECT g.id AS ingredient_id, g.name, g.unit,
            SUM(t.quantity_change) AS quantity,
            SUM(t.quantity_change * t.unit_price) AS value
        FROM inventory_transactions t JOIN ingredients g ON g.id = t.ingredient_id
        WHERE t.type = 'import' AND ${inRange("t.created_at")} AND ${ofRestaurant("t.restaurant_id")}
        GROUP BY g.id, g.name, g.unit
        ORDER BY value DESC, g.id
        LIMIT $4`,
        [...args(r), limit],
    );
    return result.rows;
};

// ---------------------------------------------------------------------------
// Tiền tip (giai đoạn 9): theo thời điểm thanh toán, chỉ payment đã thu. Hoàn tiền không trừ tip.
// ---------------------------------------------------------------------------

const TIPPED = `p.type = 'payment' AND p.status IN ('paid', 'refunded') AND p.tip_amount > 0`;

export const getTipsByStaff = async (r: IReportRange) => {
    const result = await db().query(
        `SELECT p.tip_staff_id AS staff_id, u.full_name, u.restaurant_id,
            SUM(p.tip_amount) AS tip_total, COUNT(*)::int AS payments, COUNT(DISTINCT p.order_id)::int AS orders
        FROM payments p LEFT JOIN users u ON u.id = p.tip_staff_id
        WHERE ${TIPPED} AND ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}
        GROUP BY p.tip_staff_id, u.full_name, u.restaurant_id
        ORDER BY tip_total DESC, p.tip_staff_id NULLS LAST`,
        args(r),
    );
    return result.rows;
};

export const getTipsByPeriod = async (r: IReportRange, groupBy: ReportGroupBy) => {
    const result = await db().query(
        `SELECT to_char(date_trunc($4::text, ${local("p.paid_at")}), 'YYYY-MM-DD') AS period, SUM(p.tip_amount) AS tip_total
        FROM payments p
        WHERE ${TIPPED} AND ${inRange("p.paid_at")} AND ${ofRestaurant("p.restaurant_id")}
        GROUP BY 1`,
        [...args(r), groupBy],
    );
    return result.rows as { period: string; tip_total: string }[];
};

export const getImportsBySupplier = async (r: IReportRange, limit: number) => {
    const result = await db().query(
        `SELECT NULLIF(TRIM(supplier), '') AS supplier, SUM(total_value) AS value, COUNT(*)::int AS receipts
        FROM inventory_receipts
        WHERE type = 'import' AND ${inRange("created_at")} AND ${ofRestaurant("restaurant_id")}
        GROUP BY 1 ORDER BY value DESC NULLS LAST
        LIMIT $4`,
        [...args(r), limit],
    );
    return result.rows;
};
