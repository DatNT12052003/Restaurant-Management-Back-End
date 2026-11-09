import { KitchenStationEnum, OrderItemStatusEnum, OrderStatusEnum, OrderTypeEnum, RolesEnum } from "~/common/enum";
import { db } from "~/config/db";
import {
    IKitchenLine,
    IOrder,
    IOrderLine,
    IOrderRound,
    IOrderRow,
    ISelectQuery,
    OrderLineKind,
} from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";
import { calcDiscount, calcPointsDiscount, calcTotals, ITotals } from "~/utils/billing";

/** Order chưa đóng */
export const OPEN_ORDER_STATUSES: string[] = [OrderStatusEnum.PENDING, OrderStatusEnum.CONFIRMED, OrderStatusEnum.SERVING];

/** Bảng và cột tương ứng với từng loại dòng món */
const LINE_TABLE: Record<OrderLineKind, { table: string; col: string; menu: string; link: string }> = {
    dish: { table: "order_items", col: "dish_id", menu: "dishes", link: "restaurant_dishes" },
    combo: { table: "order_combos", col: "combo_id", menu: "combos", link: "restaurant_combos" },
};

const ORDER_FIELDS = [
    "code",
    "restaurant_id",
    "reservation_id",
    "guest_user_id",
    "guest_count",
    "created_by",
    "assigned_staff_id",
    "status",
    "note",
    "cancel_reason",
    "cancelled_by",
    "completed_at",
    "cancelled_at",
    "service_fee_rate",
    "tax_rate",
    "merged_into_order_id",
    "updated_at",
];

const LINE_FIELDS = [
    "status",
    "confirmed_at",
    "cooking_at",
    "ready_at",
    "served_at",
    "cancelled_at",
    "cancel_reason",
    "cancelled_by",
    "updated_at",
];

/** Bàn đang thuộc order `o` */
const ACTIVE_TABLES = `COALESCE((
    SELECT json_agg(json_build_object(
        'id', t.id, 'name', t.name, 'capacity', t.capacity, 'status', t.status,
        'room_id', rm.id, 'room_name', rm.name, 'room_type', rm.type
    ) ORDER BY rm.name, t.name)
    FROM order_tables ot
    JOIN tables t ON t.id = ot.table_id
    JOIN rooms rm ON rm.id = t.room_id
    WHERE ot.order_id = o.id AND ot.released_at IS NULL
), '[]'::json) AS tables`;

/** Bàn cuối cùng order từng dùng (khi order đã đóng thì không còn bàn đang dùng) */
const LAST_TABLES = `COALESCE((
    SELECT json_agg(json_build_object(
        'id', t.id, 'name', t.name, 'capacity', t.capacity, 'status', t.status,
        'room_id', rm.id, 'room_name', rm.name, 'room_type', rm.type
    ) ORDER BY rm.name, t.name)
    FROM order_tables ot
    JOIN tables t ON t.id = ot.table_id
    JOIN rooms rm ON rm.id = t.room_id
    WHERE ot.order_id = o.id AND (ot.released_at IS NULL OR ot.released_at = o.completed_at OR ot.released_at = o.cancelled_at)
), '[]'::json) AS tables`;

/** Đếm dòng món theo trạng thái: {"pending": 2, "ready": 1, ...} */
const LINE_COUNTS = `COALESCE((
    SELECT json_object_agg(s.status, s.n) FROM (
        SELECT status, SUM(quantity)::int AS n FROM (
            SELECT status, quantity FROM order_items WHERE order_id = o.id
            UNION ALL
            SELECT status, quantity FROM order_combos WHERE order_id = o.id
        ) x GROUP BY status
    ) s
), '{}'::json) AS line_counts`;

const PEOPLE = [
    "(SELECT u.full_name FROM users u WHERE u.id = o.created_by) AS created_by_name",
    "(SELECT u.full_name FROM users u WHERE u.id = o.assigned_staff_id) AS assigned_staff_name",
    `(SELECT json_build_object('id', g.id, 'full_name', g.full_name, 'phone_number', g.phone_number)
        FROM users g WHERE g.id = o.guest_user_id) AS guest`,
    // Giai đoạn 5: tiền đã thu (trừ hoàn), tiền đang chờ xác nhận, mã giảm giá đang áp
    `(SELECT COALESCE(SUM(CASE
            WHEN p.type = 'payment' AND p.status IN ('paid', 'refunded') THEN p.amount
            WHEN p.type = 'refund' AND p.status = 'paid' THEN -p.amount
            ELSE 0 END), 0)::numeric(12,2)
        FROM payments p WHERE p.order_id = o.id) AS paid_amount`,
    `(SELECT COALESCE(SUM(p.amount), 0)::numeric(12,2) FROM payments p
        WHERE p.order_id = o.id AND p.type = 'payment' AND p.status IN ('pending', 'processing')) AS pending_amount`,
    `(SELECT json_build_object('id', d.id, 'code', d.code, 'name', d.name, 'type', d.type, 'value', d.value,
            'min_order_value', d.min_order_value, 'amount', od.amount_applied)
        FROM order_discounts od JOIN discounts d ON d.id = od.discount_id WHERE od.order_id = o.id) AS discount`,
    // Giai đoạn 9: order đã gộp vào order nào; tip đã nhận
    "(SELECT m.code FROM orders m WHERE m.id = o.merged_into_order_id) AS merged_into_code",
    `(SELECT COALESCE(SUM(p.tip_amount), 0)::numeric(12,2) FROM payments p
        WHERE p.order_id = o.id AND p.type = 'payment' AND p.status IN ('paid', 'refunded')) AS tip_amount`,
];

const ORDER_RETURNING = ["o.*", LAST_TABLES, LINE_COUNTS, ...PEOPLE];

/** SELECT các dòng món (món lẻ + combo) với alias chung; `where` dùng alias `l` */
const linesQuery = (where: string, extraSelect = "", extraJoin = "") => `
    SELECT * FROM (
        SELECT 'dish' AS kind, l.id, l.order_id, l.round_id, l.dish_id AS item_id, d.name, l.quantity,
            l.current_price, l.note, l.station, l.status, l.confirmed_at, l.cooking_at, l.ready_at,
            l.served_at, l.cancelled_at, l.cancel_reason, NULL::json AS combo_items, l.created_at ${extraSelect}
        FROM order_items l
        JOIN dishes d ON d.id = l.dish_id
        ${extraJoin}
        WHERE ${where}
        UNION ALL
        SELECT 'combo' AS kind, l.id, l.order_id, l.round_id, l.combo_id AS item_id, c.name, l.quantity,
            l.current_price, l.note, l.station, l.status, l.confirmed_at, l.cooking_at, l.ready_at,
            l.served_at, l.cancelled_at, l.cancel_reason,
            -- Thành phần combo theo bản chụp lúc gọi món
            COALESCE(l.items_snapshot::json, '[]'::json) AS combo_items,
            l.created_at ${extraSelect}
        FROM order_combos l
        JOIN combos c ON c.id = l.combo_id
        ${extraJoin}
        WHERE ${where}
    ) lines`;

// ---------------------------------------------------------------------------
// Đọc order
// ---------------------------------------------------------------------------

export const getOrders = async (params: ISelectQuery): Promise<{ rows: IOrder[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        code: "o.code",
        restaurant_id: "o.restaurant_id",
        reservation_id: "o.reservation_id",
        guest_user_id: "o.guest_user_id",
        status: "o.status",
        created_by: "o.created_by",
        assigned_staff_id: "o.assigned_staff_id",
        total: "o.total",
        created_at: "o.created_at",
        completed_at: "o.completed_at",
    };
    const allowedFields = Object.values(fieldMap);
    const orderBy = (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field);
    const { query, values } = buildSelectAllQuery("orders o", allowedFields, {
        ...params,
        returning: ORDER_RETURNING,
        search: params.search?.text
            ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
            : undefined,
        filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
        orderBy: orderBy.length ? orderBy : [{ field: "o.created_at", direction: OrderTypeEnum.DESC }],
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

/** Order đang mở của nhà hàng (sơ đồ phục vụ) */
export const getActiveOrders = async (restaurantId: number): Promise<IOrder[]> => {
    const result = await db().query(
        `SELECT o.*, ${ACTIVE_TABLES}, ${LINE_COUNTS}, ${PEOPLE.join(", ")}
        FROM orders o
        WHERE o.deleted_at IS NULL AND o.restaurant_id = $1 AND o.status = ANY($2)
        ORDER BY o.created_at`,
        [restaurantId, OPEN_ORDER_STATUSES],
    );
    return result.rows;
};

export const getOrderById = async (id: number): Promise<IOrder | undefined> => {
    const result = await db().query(
        `SELECT ${ORDER_RETURNING.join(", ")} FROM orders o WHERE o.id = $1 AND o.deleted_at IS NULL`,
        [id],
    );
    return result.rows[0];
};

/** Dòng orders (không kèm subquery), có thể khóa FOR UPDATE */
export const getOrderRow = async (id: number, forUpdate = false): Promise<IOrder | undefined> => {
    const result = await db().query(
        `SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
        [id],
    );
    return result.rows[0];
};

export const getOrderByReservation = async (reservationId: number): Promise<IOrder | undefined> => {
    const result = await db().query(
        "SELECT * FROM orders WHERE reservation_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        [reservationId],
    );
    return result.rows[0];
};

export const getRounds = async (orderId: number): Promise<Omit<IOrderRound, "lines">[]> => {
    const result = await db().query(
        `SELECT r.*, t.name AS table_name, u.full_name AS created_by_name
        FROM order_rounds r
        LEFT JOIN tables t ON t.id = r.table_id
        LEFT JOIN users u ON u.id = r.created_by
        WHERE r.order_id = $1
        ORDER BY r.round_no`,
        [orderId],
    );
    return result.rows;
};

export const getLines = async (orderId: number): Promise<IOrderLine[]> => {
    const result = await db().query(`${linesQuery("l.order_id = $1")} ORDER BY created_at, kind, id`, [orderId]);
    return result.rows;
};

/** Hàng chờ của bếp / quầy pha chế: món chưa phục vụ của các order đang mở */
export const getKitchenQueue = async (restaurantId: number, station?: string): Promise<IKitchenLine[]> => {
    const values: unknown[] = [
        restaurantId,
        [OrderItemStatusEnum.PENDING, OrderItemStatusEnum.CONFIRMED, OrderItemStatusEnum.COOKING, OrderItemStatusEnum.READY],
        OPEN_ORDER_STATUSES,
    ];
    let stationClause = "";
    if (station) {
        values.push(station);
        stationClause = `AND l.station = $${values.length}`;
    }
    const where = `o.restaurant_id = $1 AND o.deleted_at IS NULL AND o.status = ANY($3) AND l.status = ANY($2) ${stationClause}`;
    const extraSelect = `, o.code AS order_code, o.note AS order_note, r.round_no, r.sent_at,
        COALESCE(rt.name, (
            SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM order_tables ot JOIN tables t ON t.id = ot.table_id
            WHERE ot.order_id = o.id AND ot.released_at IS NULL
        )) AS table_names`;
    const extraJoin = `JOIN orders o ON o.id = l.order_id
        JOIN order_rounds r ON r.id = l.round_id
        LEFT JOIN tables rt ON rt.id = r.table_id`;
    const result = await db().query(`${linesQuery(where, extraSelect, extraJoin)} ORDER BY sent_at, kind, id`, values);
    return result.rows;
};

// ---------------------------------------------------------------------------
// Ghi order
// ---------------------------------------------------------------------------

/**
 * Mã order kế tiếp trong ngày của nhà hàng: R{id}-YYYYMMDD-NNNN (theo giờ Việt Nam).
 * Khóa advisory trong transaction để hai order mở cùng lúc không trùng số.
 */
export const nextOrderCode = async (restaurantId: number): Promise<string> => {
    await db().query("SELECT pg_advisory_xact_lock(hashtext('order_code'), $1)", [restaurantId]);
    const result = await db().query(
        `SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') AS day,
            COUNT(o.id)::int + 1 AS seq
        FROM (SELECT 1) x
        LEFT JOIN orders o ON o.restaurant_id = $1
            AND (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        GROUP BY 1`,
        [restaurantId],
    );
    const { day, seq } = result.rows[0];
    return `R${restaurantId}-${day}-${String(seq).padStart(4, "0")}`;
};

export const createOrder = async (row: IOrderRow): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("orders", row, ORDER_FIELDS, ["id"]);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateOrder = async (id: number, row: IOrderRow): Promise<{ id: number } | undefined> => {
    const { query, values } = buildUpdateQuery(
        "orders",
        { field: "id", value: id },
        { ...row, updated_at: new Date() },
        ORDER_FIELDS,
        ["id"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

/**
 * Tính lại tiền của order (gọi trong transaction mỗi khi món / mã giảm giá thay đổi):
 * tạm tính = các dòng chưa hủy; giảm giá theo mã đang áp; phí dịch vụ và thuế theo tỷ lệ đã chụp lúc mở order.
 */
export const recomputeTotals = async (orderId: number): Promise<ITotals | undefined> => {
    const result = await db().query(
        `SELECT o.service_fee_rate, o.tax_rate, od.id AS order_discount_id,
            d.type, d.value, d.min_order_value, d.max_discount,
            o.points_redeemed, ls.point_value, ls.max_redeem_percent,
            (SELECT COALESCE(SUM(current_price * quantity), 0) FROM (
                SELECT current_price, quantity FROM order_items WHERE order_id = o.id AND status <> 'cancelled'
                UNION ALL
                SELECT current_price, quantity FROM order_combos WHERE order_id = o.id AND status <> 'cancelled'
            ) x) AS subtotal
        FROM orders o
        LEFT JOIN order_discounts od ON od.order_id = o.id
        LEFT JOIN discounts d ON d.id = od.discount_id
        LEFT JOIN loyalty_settings ls ON ls.id = 1
        WHERE o.id = $1`,
        [orderId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const subtotal = Number(row.subtotal);
    const discount = row.order_discount_id ? calcDiscount(subtotal, row) : 0;
    // Giai đoạn 13: đổi điểm, tối đa `max_redeem_percent`% phần còn lại sau mã giảm giá. Món bị hủy làm trần giảm thì bớt điểm đổi.
    const points = calcPointsDiscount(subtotal - discount, Number(row.points_redeemed), Number(row.point_value ?? 0), Number(row.max_redeem_percent ?? 0));
    if (Number(row.points_redeemed) > 0) {
        await db().query("UPDATE orders SET points_redeemed = $2, points_discount = $3 WHERE id = $1", [orderId, points.points, points.amount]);
    }
    const totals = calcTotals(subtotal, discount + points.amount, row.service_fee_rate, row.tax_rate);
    if (row.order_discount_id) {
        await db().query("UPDATE order_discounts SET amount_applied = $2, updated_at = NOW() WHERE id = $1", [
            row.order_discount_id,
            discount,
        ]);
    }
    await db().query(
        `UPDATE orders SET subtotal = $2, discount_amount = $3, service_fee = $4, tax = $5, total = $6, updated_at = NOW()
        WHERE id = $1`,
        [orderId, totals.subtotal, totals.discount_amount, totals.service_fee, totals.tax, totals.total],
    );
    return totals;
};

// ---------------------------------------------------------------------------
// Bàn của order
// ---------------------------------------------------------------------------

/** Các bàn trong danh sách đang thuộc một order mở khác */
export const findBusyTables = async (tableIds: number[], excludeOrderId = 0): Promise<number[]> => {
    if (tableIds.length === 0) return [];
    const result = await db().query(
        `SELECT ot.table_id FROM order_tables ot
        WHERE ot.released_at IS NULL AND ot.table_id = ANY($1::int[]) AND ot.order_id <> $2`,
        [tableIds, excludeOrderId],
    );
    return result.rows.map((r) => r.table_id);
};

export const getActiveTableIds = async (orderId: number): Promise<number[]> => {
    const result = await db().query(
        "SELECT table_id FROM order_tables WHERE order_id = $1 AND released_at IS NULL ORDER BY id",
        [orderId],
    );
    return result.rows.map((r) => r.table_id);
};

export const addOrderTables = async (orderId: number, tableIds: number[]): Promise<void> => {
    if (tableIds.length === 0) return;
    await db().query("INSERT INTO order_tables (order_id, table_id) SELECT $1, unnest($2::int[])", [orderId, tableIds]);
};

/** Trả bàn; `tableIds` không truyền = trả mọi bàn của order. `at` dùng chung mốc thời gian với lúc đóng order. */
export const releaseOrderTables = async (orderId: number, tableIds?: number[], at = new Date()): Promise<number[]> => {
    const result = tableIds
        ? await db().query(
              `UPDATE order_tables SET released_at = $3
              WHERE order_id = $1 AND table_id = ANY($2::int[]) AND released_at IS NULL RETURNING table_id`,
              [orderId, tableIds, at],
          )
        : await db().query(
              "UPDATE order_tables SET released_at = $2 WHERE order_id = $1 AND released_at IS NULL RETURNING table_id",
              [orderId, at],
          );
    return result.rows.map((r) => r.table_id);
};

/** Đổi trạng thái các bàn (bỏ qua bàn đã xóa) */
export const setTablesStatus = async (tableIds: number[], status: string): Promise<void> => {
    if (tableIds.length === 0) return;
    await db().query(
        "UPDATE tables SET status = $2, updated_at = NOW() WHERE id = ANY($1::int[]) AND deleted_at IS NULL",
        [tableIds, status],
    );
};

/** Số order đang mở giữ bàn này */
export const countOpenOrdersByTable = async (tableId: number): Promise<number> => {
    const result = await db().query(
        "SELECT COUNT(*)::int AS count FROM order_tables WHERE table_id = $1 AND released_at IS NULL",
        [tableId],
    );
    return result.rows[0].count;
};

// ---------------------------------------------------------------------------
// Đợt gọi món
// ---------------------------------------------------------------------------

/**
 * Giá đang bán tại nhà hàng và nơi chế biến của món / combo.
 * Chỉ trả về những món đang bán (chưa xóa, `active`, chi nhánh không tắt).
 * Combo được chuyển cho quầy pha chế nếu toàn bộ món trong combo là đồ uống, ngược lại cho bếp.
 */
export const getSellableItems = async (
    kind: OrderLineKind,
    restaurantId: number,
    ids: number[],
): Promise<{ id: number; price: string; station: string }[]> => {
    if (ids.length === 0) return [];
    const { menu, link, col } = LINE_TABLE[kind];
    const station =
        kind === "dish"
            ? "CASE WHEN m.category = 'drink' THEN 'bar' ELSE 'kitchen' END"
            : `CASE WHEN NOT EXISTS (
                SELECT 1 FROM combo_items ci JOIN dishes dd ON dd.id = ci.dish_id
                WHERE ci.combo_id = m.id AND dd.category <> 'drink'
            ) THEN 'bar' ELSE 'kitchen' END`;
    const result = await db().query(
        `SELECT m.id, COALESCE(rm.price, m.price) AS price, ${station} AS station
        FROM ${menu} m
        LEFT JOIN ${link} rm ON rm.${col} = m.id AND rm.restaurant_id = $2
        WHERE m.id = ANY($1::int[]) AND m.deleted_at IS NULL AND m.status = 'active'
            AND COALESCE(rm.is_available, true)`,
        [ids, restaurantId],
    );
    return result.rows;
};

export const createRound = async (row: {
    order_id: number;
    table_id: number | null;
    note: string | null;
    created_by: number | null;
    /** Giữ giờ gửi của đợt gốc (khi tách order) để món không bị xếp xuống cuối hàng chờ bếp */
    sent_at?: Date;
}): Promise<{ id: number; round_no: number }> => {
    const result = await db().query(
        `INSERT INTO order_rounds (order_id, table_id, note, created_by, round_no, sent_at)
        VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(round_no), 0) + 1 FROM order_rounds WHERE order_id = $1),
            COALESCE($5::timestamptz, NOW()))
        RETURNING id, round_no`,
        [row.order_id, row.table_id, row.note, row.created_by, row.sent_at ?? null],
    );
    return result.rows[0];
};

export interface IRoundRow {
    id: number;
    order_id: number;
    round_no: number;
    note: string | null;
    created_by: number | null;
    sent_at: Date;
}

export const getRoundById = async (id: number): Promise<IRoundRow | undefined> => {
    const result = await db().query(
        "SELECT id, order_id, round_no, note, created_by, sent_at FROM order_rounds WHERE id = $1",
        [id],
    );
    return result.rows[0];
};

export const insertLines = async (
    kind: OrderLineKind,
    orderId: number,
    roundId: number,
    lines: { item_id: number; quantity: number; price: string; note: string | null; station: string }[],
): Promise<void> => {
    if (lines.length === 0) return;
    const { table, col } = LINE_TABLE[kind];
    // Combo: chụp lại thành phần tại thời điểm gọi, đổi công thức combo sau này không làm sai lịch sử
    const isCombo = kind === "combo";
    const snapshot = isCombo
        ? `, COALESCE((
            SELECT jsonb_agg(jsonb_build_object('dish_id', ci.dish_id, 'name', d.name, 'quantity', ci.quantity)
                ORDER BY d.name)
            FROM combo_items ci JOIN dishes d ON d.id = ci.dish_id
            WHERE ci.combo_id = x.item_id
        ), '[]'::jsonb)`
        : "";
    await db().query(
        `INSERT INTO ${table} (order_id, round_id, ${col}, quantity, current_price, note, station${isCombo ? ", items_snapshot" : ""})
        SELECT $1, $2, x.item_id, x.quantity, x.price, x.note, x.station ${snapshot}
        FROM json_to_recordset($3::json) AS x(item_id int, quantity int, price numeric, note text, station text)`,
        [orderId, roundId, JSON.stringify(lines)],
    );
};

// ---------------------------------------------------------------------------
// Trạng thái món
// ---------------------------------------------------------------------------

/** Dòng món kèm order của nó, khóa cả hai (FOR UPDATE) */
export const getLineForUpdate = async (
    kind: OrderLineKind,
    id: number,
): Promise<
    | {
          id: number;
          order_id: number;
          round_id: number;
          status: OrderItemStatusEnum;
          station: KitchenStationEnum;
          quantity: number;
          current_price: string;
          restaurant_id: number;
          order_status: OrderStatusEnum;
          order_code: string;
      }
    | undefined
> => {
    const { table } = LINE_TABLE[kind];
    const result = await db().query(
        `SELECT l.id, l.order_id, l.round_id, l.status, l.station, l.quantity, l.current_price,
            o.restaurant_id, o.status AS order_status, o.code AS order_code
        FROM ${table} l JOIN orders o ON o.id = l.order_id AND o.deleted_at IS NULL
        WHERE l.id = $1
        FOR UPDATE OF l, o`,
        [id],
    );
    return result.rows[0];
};

/** order_id của các dòng món (không khóa), để khóa order trước theo thứ tự id */
export const getLineOrderIds = async (lines: { kind: OrderLineKind; id: number }[]): Promise<number[]> => {
    const ids: number[] = [];
    for (const kind of ["dish", "combo"] as OrderLineKind[]) {
        const lineIds = lines.filter((l) => l.kind === kind).map((l) => l.id);
        if (lineIds.length === 0) continue;
        const result = await db().query(
            `SELECT DISTINCT order_id FROM ${LINE_TABLE[kind].table} WHERE id = ANY($1::int[])`,
            [lineIds],
        );
        ids.push(...result.rows.map((r) => r.order_id));
    }
    return [...new Set(ids)].sort((a, b) => a - b);
};

/** Các dòng món của một đợt gọi món */
export const getRoundLineRefs = async (roundId: number): Promise<{ kind: OrderLineKind; id: number }[]> => {
    const result = await db().query(
        `SELECT 'dish' AS kind, id FROM order_items WHERE round_id = $1
        UNION ALL SELECT 'combo' AS kind, id FROM order_combos WHERE round_id = $1
        ORDER BY kind DESC, id`,
        [roundId],
    );
    return result.rows;
};

export const updateLine = async (kind: OrderLineKind, id: number, row: Record<string, unknown>): Promise<void> => {
    const { query, values } = buildUpdateQuery(LINE_TABLE[kind].table, { field: "id", value: id }, { ...row, updated_at: new Date() }, LINE_FIELDS, ["id"]);
    await db().query(query, values);
};

/** Hủy mọi dòng chưa phục vụ / chưa hủy của order (khi hủy order) */
export const cancelOpenLines = async (orderId: number, actorId: number | null, reason: string | null): Promise<void> => {
    for (const { table } of Object.values(LINE_TABLE)) {
        await db().query(
            `UPDATE ${table} SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
                cancel_reason = COALESCE(cancel_reason, $3), updated_at = NOW()
            WHERE order_id = $1 AND status NOT IN ('served', 'cancelled')`,
            [orderId, actorId, reason],
        );
    }
};

// ---------------------------------------------------------------------------
// Gộp / tách order (giai đoạn 9)
// ---------------------------------------------------------------------------

/** Chuyển mọi đợt gọi món và dòng món của `sourceId` sang `targetId`; số đợt được đánh tiếp sau đợt cuối của order đích */
export const moveAllRoundsAndLines = async (sourceId: number, targetId: number): Promise<void> => {
    await db().query(
        `UPDATE order_rounds r SET order_id = $2, round_no = x.new_no
        FROM (
            SELECT id, (SELECT COALESCE(MAX(round_no), 0) FROM order_rounds WHERE order_id = $2)
                + ROW_NUMBER() OVER (ORDER BY round_no) AS new_no
            FROM order_rounds WHERE order_id = $1
        ) x
        WHERE r.id = x.id`,
        [sourceId, targetId],
    );
    for (const { table } of Object.values(LINE_TABLE)) {
        await db().query(`UPDATE ${table} SET order_id = $2, updated_at = NOW() WHERE order_id = $1`, [sourceId, targetId]);
    }
};

/**
 * Chuyển `quantity` phần của một dòng món sang order khác (đợt `roundId` của order đích).
 * Chuyển hết thì đổi order của dòng; chuyển một phần thì giảm số lượng dòng cũ và chép sang một dòng mới
 * (giữ nguyên giá, trạng thái, các mốc thời gian, ghi chú, thành phần combo).
 */
export const moveLine = async (
    kind: OrderLineKind,
    lineId: number,
    lineQuantity: number,
    quantity: number,
    targetOrderId: number,
    roundId: number,
): Promise<void> => {
    const { table, col } = LINE_TABLE[kind];
    if (quantity >= lineQuantity) {
        await db().query(`UPDATE ${table} SET order_id = $2, round_id = $3, updated_at = NOW() WHERE id = $1`, [
            lineId,
            targetOrderId,
            roundId,
        ]);
        return;
    }
    const extra = kind === "combo" ? ", items_snapshot" : "";
    const copied = `${col}, current_price, note, station, status, confirmed_at, cooking_at, ready_at, served_at,
        cancelled_at, cancel_reason, cancelled_by, created_at${extra}`;
    // Giá vốn (món đã phục vụ) chia theo số lượng: phần chuyển đi = cost × q / số lượng cũ, phần còn lại = phần dư
    await db().query(
        `INSERT INTO ${table} (order_id, round_id, quantity, cost, ${copied})
        SELECT $2, $3, $4::int, ROUND(cost * $4::int / quantity, 2), ${copied} FROM ${table} WHERE id = $1`,
        [lineId, targetOrderId, roundId, quantity],
    );
    await db().query(
        `UPDATE ${table} SET cost = cost - ROUND(cost * $2::int / quantity, 2), quantity = quantity - $2::int, updated_at = NOW() WHERE id = $1`,
        [lineId, quantity],
    );
};

/** Order đang mở có áp mã giảm giá này */
export const getOpenOrderIdsByDiscount = async (discountId: number): Promise<number[]> => {
    const result = await db().query(
        `SELECT o.id FROM orders o JOIN order_discounts od ON od.order_id = o.id
        WHERE od.discount_id = $1 AND o.deleted_at IS NULL AND o.status = ANY($2) ORDER BY o.id`,
        [discountId, OPEN_ORDER_STATUSES],
    );
    return result.rows.map((r) => r.id);
};

/** Số lượng món (theo quantity) ở từng trạng thái */
export const countLinesByStatus = async (orderId: number): Promise<Partial<Record<OrderItemStatusEnum, number>>> => {
    const result = await db().query(
        `SELECT status, SUM(quantity)::int AS n FROM (
            SELECT status, quantity FROM order_items WHERE order_id = $1
            UNION ALL SELECT status, quantity FROM order_combos WHERE order_id = $1
        ) x GROUP BY status`,
        [orderId],
    );
    return Object.fromEntries(result.rows.map((r) => [r.status, r.n]));
};

// ---------------------------------------------------------------------------
// Người liên quan
// ---------------------------------------------------------------------------

/** Nhân viên đang làm (không phải khách) */
export const getStaffById = async (id: number): Promise<{ id: number; restaurant_id: number | null } | undefined> => {
    const result = await db().query(
        `SELECT u.id, u.restaurant_id FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND NOT EXISTS (
            SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.type_name = $2
        )`,
        [id, RolesEnum.GUEST],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Giai đoạn 13: điểm thưởng, gọi món QR
// ---------------------------------------------------------------------------

export const setPointsRedeemed = async (orderId: number, points: number): Promise<void> => {
    await db().query("UPDATE orders SET points_redeemed = $2, points_discount = 0, updated_at = NOW() WHERE id = $1", [orderId, points]);
};

export const setPointsAwarded = async (orderId: number, points: number): Promise<void> => {
    await db().query("UPDATE orders SET points_awarded = $2 WHERE id = $1", [orderId, points]);
};

/** Order đang mở của một bàn (nếu có) */
export const getOpenOrderIdByTable = async (tableId: number): Promise<number | undefined> => {
    const result = await db().query(
        `SELECT ot.order_id FROM order_tables ot JOIN orders o ON o.id = ot.order_id
        WHERE ot.table_id = $1 AND ot.released_at IS NULL AND o.status = ANY($2::text[]) AND o.deleted_at IS NULL LIMIT 1`,
        [tableId, OPEN_ORDER_STATUSES],
    );
    return result.rows[0]?.order_id;
};
