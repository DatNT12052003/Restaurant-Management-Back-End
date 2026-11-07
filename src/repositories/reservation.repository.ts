import { ReservationStatusEnum, RolesEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IAvailableTable, IReservation, IReservationRow, IReservationTable, ISelectQuery } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

/** Trạng thái còn giữ bàn (khớp với trigger trong migration create-reservations-tables) */
export const ACTIVE_RESERVATION_STATUSES: string[] = [
    ReservationStatusEnum.PENDING,
    ReservationStatusEnum.CONFIRMED,
    ReservationStatusEnum.ARRIVED,
];

const WRITABLE_FIELDS = [
    "restaurant_id",
    "guest_user_id",
    "contact_name",
    "contact_phone",
    "guest_count",
    "start_time",
    "end_time",
    "status",
    "note",
    "cancel_reason",
    "arrived_at",
    "completed_at",
    "cancelled_at",
    "created_by",
    "updated_at",
];

const TABLE_JSON = `json_build_object(
    'id', t.id, 'name', t.name, 'capacity', t.capacity, 'status', t.status,
    'room_id', rm.id, 'room_name', rm.name, 'room_type', rm.type
)`;

/** Danh sách bàn của reservation `rs` (bàn đã xóa vẫn hiện để giữ lịch sử) */
const TABLES_SUBQUERY = `COALESCE((
    SELECT json_agg(${TABLE_JSON} ORDER BY rm.name, t.name)
    FROM reservation_tables rt
    JOIN tables t ON t.id = rt.table_id
    JOIN rooms rm ON rm.id = t.room_id
    WHERE rt.reservation_id = rs.id
), '[]'::json) AS tables`;

const GUEST_SUBQUERY = `(
    SELECT json_build_object('id', g.id, 'full_name', g.full_name, 'phone_number', g.phone_number, 'email', g.email)
    FROM users g WHERE g.id = rs.guest_user_id
) AS guest`;

const CREATED_BY_SUBQUERY = `(SELECT cb.full_name FROM users cb WHERE cb.id = rs.created_by) AS created_by_name`;

/** Order mở từ reservation (giai đoạn 4) */
const ORDER_SUBQUERY = `(
    SELECT json_build_object('id', o.id, 'code', o.code, 'status', o.status)
    FROM orders o WHERE o.reservation_id = rs.id AND o.deleted_at IS NULL
    ORDER BY o.id DESC LIMIT 1
) AS "order"`;

const RETURNING = ["rs.*", TABLES_SUBQUERY, GUEST_SUBQUERY, CREATED_BY_SUBQUERY, ORDER_SUBQUERY];

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

export const getReservations = async (params: ISelectQuery): Promise<{ rows: IReservation[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        restaurant_id: "rs.restaurant_id",
        guest_user_id: "rs.guest_user_id",
        contact_name: "rs.contact_name",
        contact_phone: "rs.contact_phone",
        guest_count: "rs.guest_count",
        start_time: "rs.start_time",
        end_time: "rs.end_time",
        status: "rs.status",
        created_by: "rs.created_by",
        created_at: "rs.created_at",
        updated_at: "rs.updated_at",
    };
    const allowedFields = Object.values(fieldMap);

    const orderBy = (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field);
    const { query, values } = buildSelectAllQuery("reservations rs", allowedFields, {
        ...params,
        returning: RETURNING,
        search: params.search?.text
            ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
            : undefined,
        filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
        orderBy: orderBy.length ? orderBy : [{ field: "rs.start_time" }],
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};

/** Mọi reservation (mọi trạng thái) của nhà hàng có thời gian giao với [from, to) — dùng cho lịch theo ngày */
export const getSchedule = async (restaurantId: number, from: Date, to: Date): Promise<IReservation[]> => {
    const result = await db().query(
        `SELECT ${RETURNING.join(", ")}
        FROM reservations rs
        WHERE rs.deleted_at IS NULL AND rs.restaurant_id = $1 AND rs.start_time < $3 AND rs.end_time > $2
        ORDER BY rs.start_time, rs.id`,
        [restaurantId, from, to],
    );
    return result.rows;
};

export const getReservationById = async (id: number, forUpdate = false): Promise<IReservation | undefined> => {
    if (forUpdate) {
        // Khóa dòng trước, rồi mới đọc kèm subquery (FOR UPDATE không dùng được với json_agg)
        await db().query("SELECT id FROM reservations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
    }
    const result = await db().query(
        `SELECT ${RETURNING.join(", ")} FROM reservations rs WHERE rs.id = $1 AND rs.deleted_at IS NULL`,
        [id],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Bàn
// ---------------------------------------------------------------------------

/**
 * Bàn hợp lệ để đặt trong nhà hàng: chưa xóa, phòng chưa xóa và đang hoạt động.
 * Khóa các dòng bàn (FOR UPDATE) để hai lần đặt cùng lúc trên cùng bàn chạy tuần tự.
 */
export const getBookableTables = async (restaurantId: number, tableIds: number[]): Promise<IReservationTable[]> => {
    if (tableIds.length === 0) return [];
    const result = await db().query(
        `SELECT t.id, t.name, t.capacity, t.status, rm.id AS room_id, rm.name AS room_name, rm.type AS room_type
        FROM tables t
        JOIN rooms rm ON rm.id = t.room_id AND rm.deleted_at IS NULL AND rm.is_active
        WHERE t.id = ANY($1::int[]) AND t.deleted_at IS NULL AND rm.restaurant_id = $2
        ORDER BY t.id
        FOR UPDATE OF t`,
        [tableIds, restaurantId],
    );
    return result.rows;
};

/** Tên các bàn trong `tableIds` đã có reservation còn hiệu lực chồng lên [start, end) */
export const findConflictingTables = async (
    tableIds: number[],
    start: Date,
    end: Date,
    excludeReservationId?: number,
): Promise<{ table_id: number; reservation_id: number }[]> => {
    if (tableIds.length === 0) return [];
    const result = await db().query(
        `SELECT rt.table_id, rt.reservation_id
        FROM reservation_tables rt
        WHERE rt.is_active
            AND rt.table_id = ANY($1::int[])
            AND rt.period && tstzrange($2, $3, '[)')
            AND rt.reservation_id <> $4`,
        [tableIds, start, end, excludeReservationId ?? 0],
    );
    return result.rows;
};

/** Bàn trống trong khoảng [start, end) của nhà hàng (phòng đang hoạt động, không có reservation chồng giờ) */
export const getAvailableTables = async (
    restaurantId: number,
    start: Date,
    end: Date,
    roomType?: string,
    excludeReservationId?: number,
): Promise<IAvailableTable[]> => {
    const values: unknown[] = [restaurantId, start, end, excludeReservationId ?? 0];
    let roomTypeClause = "";
    if (roomType) {
        values.push(roomType);
        roomTypeClause = `AND rm.type = $${values.length}`;
    }
    const result = await db().query(
        `SELECT t.id, t.name, t.capacity, t.status, rm.id AS room_id, rm.name AS room_name, rm.type AS room_type
        FROM tables t
        JOIN rooms rm ON rm.id = t.room_id AND rm.deleted_at IS NULL AND rm.is_active
        WHERE t.deleted_at IS NULL AND rm.restaurant_id = $1 ${roomTypeClause}
            AND NOT EXISTS (
                SELECT 1 FROM reservation_tables rt
                WHERE rt.table_id = t.id AND rt.is_active
                    AND rt.period && tstzrange($2, $3, '[)')
                    AND rt.reservation_id <> $4
            )
        ORDER BY rm.name, t.name`,
        values,
    );
    return result.rows;
};

/** Gỡ mọi bàn của reservation (bảng nối, xóa cứng) */
export const clearReservationTables = async (reservationId: number): Promise<void> => {
    await db().query("DELETE FROM reservation_tables WHERE reservation_id = $1", [reservationId]);
};

/**
 * Gắn bàn cho reservation. `period` / `is_active` lấy theo giờ hiện tại của reservation,
 * nên khi đổi giờ phải: gỡ bàn -> cập nhật giờ -> gắn lại bàn (tránh báo trùng với giờ cũ).
 */
export const addReservationTables = async (reservationId: number, tableIds: number[]): Promise<void> => {
    if (tableIds.length === 0) return;
    // period / is_active do trigger reservation_tables_fill điền
    await db().query(
        `INSERT INTO reservation_tables (reservation_id, table_id, period)
        SELECT $1, unnest($2::int[]), 'empty'::tstzrange`,
        [reservationId, tableIds],
    );
};

/** Đổi trạng thái bàn của reservation, chỉ với các bàn đang ở một trong `fromStatuses` */
export const setTablesStatus = async (
    reservationId: number,
    status: string,
    fromStatuses: string[],
): Promise<number[]> => {
    const result = await db().query(
        `UPDATE tables t SET status = $2, updated_at = NOW()
        FROM reservation_tables rt
        WHERE rt.reservation_id = $1 AND rt.table_id = t.id AND t.deleted_at IS NULL AND t.status = ANY($3)
        RETURNING t.id`,
        [reservationId, status, fromStatuses],
    );
    return result.rows.map((r) => r.id);
};

/** Số reservation còn hiệu lực, chưa kết thúc, đang giữ các bàn này */
export const countUpcomingByTables = async (tableIds: number[]): Promise<number> => {
    if (tableIds.length === 0) return 0;
    const result = await db().query(
        `SELECT COUNT(DISTINCT rt.reservation_id)::int AS count
        FROM reservation_tables rt
        WHERE rt.is_active AND rt.table_id = ANY($1::int[]) AND upper(rt.period) > NOW()`,
        [tableIds],
    );
    return result.rows[0].count;
};

export const countUpcomingByRoom = async (roomId: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(DISTINCT rt.reservation_id)::int AS count
        FROM reservation_tables rt
        JOIN tables t ON t.id = rt.table_id AND t.deleted_at IS NULL
        WHERE rt.is_active AND t.room_id = $1 AND upper(rt.period) > NOW()`,
        [roomId],
    );
    return result.rows[0].count;
};

// ---------------------------------------------------------------------------
// Khách
// ---------------------------------------------------------------------------

/** Người dùng có vai trò guest (chưa xóa) */
export const getGuestById = async (
    id: number,
): Promise<{ id: number; full_name: string; phone_number: string | null } | undefined> => {
    const result = await db().query(
        `SELECT u.id, u.full_name, u.phone_number
        FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.type_name = $2
        )`,
        [id, RolesEnum.GUEST],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Ghi
// ---------------------------------------------------------------------------

export const createReservation = async (payload: IReservationRow): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("reservations", payload, WRITABLE_FIELDS, ["id"]);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateReservation = async (id: number, payload: IReservationRow): Promise<{ id: number } | undefined> => {
    const { query, values } = buildUpdateQuery(
        "reservations",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        WRITABLE_FIELDS,
        ["id"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

/** Xóa mềm; trigger tự gỡ giữ chỗ trên bàn (is_active = false) */
export const deleteReservation = async (id: number): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        "UPDATE reservations SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, deleted_at",
        [id],
    );
    return result.rows[0];
};
