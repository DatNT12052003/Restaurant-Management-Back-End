import { db } from "~/config/db";
import {
    IAdjustment,
    IAllowance,
    IAttendance,
    ICompensation,
    IHrSettingsBody,
    IHrSettingsRow,
    ILeaveRequest,
    IPayroll,
    IPayrollItem,
    IShiftAssignment,
    IShiftSwap,
    IShiftTemplate,
    IShiftTemplateBody,
    IStaffMember,
    IStaffReview,
} from "~/interfaces";
import { buildInsertQuery, buildUpdateQuery } from "~/utils/query-builder";

/** Giai đoạn 12: nhân sự — cấu hình, nhân viên, ca làm, đổi ca, chấm công, nghỉ phép, lương, đánh giá */

const TZ = "Asia/Ho_Chi_Minh";
const DATE = (col: string, alias = col.split(".").pop()) => `to_char(${col}, 'YYYY-MM-DD') AS ${alias}`;
const userName = (col: string, alias: string) => `(SELECT u.full_name FROM users u WHERE u.id = ${col}) AS ${alias}`;

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

const SETTINGS_FIELDS = [
    "standard_work_days",
    "standard_hours_per_day",
    "late_grace_minutes",
    "early_leave_grace_minutes",
    "late_penalty_amount",
    "overtime_threshold_minutes",
    "overtime_multiplier",
    "early_clock_in_minutes",
    "updated_at",
];

/** Cấu hình của chi nhánh; chưa có thì tạo dòng mặc định (để có khóa ký mã QR) */
export const getSettings = async (restaurantId: number): Promise<IHrSettingsRow> => {
    await db().query("INSERT INTO hr_settings (restaurant_id) VALUES ($1) ON CONFLICT (restaurant_id) DO NOTHING", [restaurantId]);
    return (await db().query("SELECT * FROM hr_settings WHERE restaurant_id = $1", [restaurantId])).rows[0];
};

export const updateSettings = async (restaurantId: number, body: IHrSettingsBody): Promise<IHrSettingsRow> => {
    await getSettings(restaurantId);
    const { query, values } = buildUpdateQuery(
        "hr_settings",
        { field: "restaurant_id", value: restaurantId },
        { ...body, updated_at: new Date() },
        SETTINGS_FIELDS,
    );
    return (await db().query(query, values)).rows[0];
};

export const rotateQrSecret = async (restaurantId: number): Promise<void> => {
    await getSettings(restaurantId);
    await db().query(
        "UPDATE hr_settings SET qr_secret = md5(random()::text || clock_timestamp()::text), updated_at = NOW() WHERE restaurant_id = $1",
        [restaurantId],
    );
};

// ---------------------------------------------------------------------------
// Nhân viên
// ---------------------------------------------------------------------------

const STAFF_SELECT = `SELECT u.id, u.full_name, u.avatar_url, u.status, u.restaurant_id,
        COALESCE((SELECT array_agg(r.type_name ORDER BY r.type_name) FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL), '{}') AS roles,
        c.pay_type, c.amount AS pay_amount
    FROM users u
    LEFT JOIN LATERAL (
        SELECT ec.pay_type, ec.amount FROM employee_compensations ec
        WHERE ec.user_id = u.id AND ec.effective_from <= (now() AT TIME ZONE '${TZ}')::date
        ORDER BY ec.effective_from DESC LIMIT 1
    ) c ON true
    WHERE u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.type_name = 'guest')`;

/** Nhân viên (không phải khách) của chi nhánh; mặc định chỉ người đang làm */
export const getStaff = async (restaurantId: number, includeInactive = false): Promise<IStaffMember[]> => {
    const result = await db().query(
        `${STAFF_SELECT} AND u.restaurant_id = $1 AND ($2::boolean OR u.status = 'active') ORDER BY lower(u.full_name), u.id`,
        [restaurantId, includeInactive],
    );
    return result.rows;
};

export const getStaffMember = async (userId: number): Promise<IStaffMember | undefined> => {
    return (await db().query(`${STAFF_SELECT} AND u.id = $1`, [userId])).rows[0];
};

export const getStaffMembers = async (userIds: number[]): Promise<IStaffMember[]> => {
    if (userIds.length === 0) return [];
    return (await db().query(`${STAFF_SELECT} AND u.id = ANY($1::int[])`, [userIds])).rows;
};

// ---------------------------------------------------------------------------
// Ca mẫu
// ---------------------------------------------------------------------------

const TEMPLATE_FIELDS = ["restaurant_id", "name", "start_time", "end_time", "break_minutes", "status", "updated_at"];
const TEMPLATE_RETURNING = ["*", "to_char(start_time, 'HH24:MI') AS start_time", "to_char(end_time, 'HH24:MI') AS end_time"];

export const getTemplates = async (restaurantId: number): Promise<IShiftTemplate[]> => {
    const result = await db().query(
        `SELECT ${TEMPLATE_RETURNING.join(", ")} FROM shift_templates
        WHERE restaurant_id = $1 AND deleted_at IS NULL ORDER BY shift_templates.start_time, lower(shift_templates.name)`,
        [restaurantId],
    );
    return result.rows;
};

export const getTemplateById = async (id: number): Promise<IShiftTemplate | undefined> => {
    const result = await db().query(`SELECT ${TEMPLATE_RETURNING.join(", ")} FROM shift_templates WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return result.rows[0];
};

export const createTemplate = async (body: IShiftTemplateBody): Promise<IShiftTemplate> => {
    const { query, values } = buildInsertQuery("shift_templates", body, TEMPLATE_FIELDS, TEMPLATE_RETURNING);
    return (await db().query(query, values)).rows[0];
};

export const updateTemplate = async (id: number, body: IShiftTemplateBody): Promise<IShiftTemplate | undefined> => {
    const { query, values } = buildUpdateQuery(
        "shift_templates",
        { field: "id", value: id },
        { ...body, restaurant_id: undefined, updated_at: new Date() },
        TEMPLATE_FIELDS,
        TEMPLATE_RETURNING,
        true,
    );
    return (await db().query(query, values)).rows[0];
};

export const deleteTemplate = async (id: number): Promise<{ id: number } | undefined> => {
    return (await db().query("UPDATE shift_templates SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id", [id])).rows[0];
};

// ---------------------------------------------------------------------------
// Lịch làm việc
// ---------------------------------------------------------------------------

const SHIFT_RETURNING = [
    "sa.*",
    DATE("sa.work_date"),
    "(SELECT u.full_name FROM users u WHERE u.id = sa.user_id) AS full_name",
    "(SELECT t.name FROM shift_templates t WHERE t.id = sa.shift_template_id) AS template_name",
    "(SELECT a.id FROM attendance_records a WHERE a.assignment_id = sa.id AND a.deleted_at IS NULL) AS attendance_id",
];

export const getShifts = async (filter: {
    restaurantId: number | null;
    from: string;
    to: string;
    userId?: number;
}): Promise<IShiftAssignment[]> => {
    const result = await db().query(
        `SELECT ${SHIFT_RETURNING.join(", ")},
            EXISTS (SELECT 1 FROM leave_requests l WHERE l.user_id = sa.user_id AND l.status = 'approved'
                AND sa.work_date BETWEEN l.start_date AND l.end_date) AS on_leave
        FROM shift_assignments sa
        WHERE sa.deleted_at IS NULL AND sa.work_date BETWEEN $1 AND $2
            AND ($3::int IS NULL OR sa.restaurant_id = $3::int)
            AND ($4::int IS NULL OR sa.user_id = $4::int)
        ORDER BY sa.start_at, sa.user_id`,
        [filter.from, filter.to, filter.restaurantId, filter.userId ?? null],
    );
    return result.rows;
};

export const getShiftById = async (id: number, forUpdate = false): Promise<IShiftAssignment | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM shift_assignments WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${SHIFT_RETURNING.join(", ")} FROM shift_assignments sa WHERE sa.id = $1 AND sa.deleted_at IS NULL`, [id]);
    return result.rows[0];
};

const SHIFT_FIELDS = ["restaurant_id", "user_id", "shift_template_id", "work_date", "start_at", "end_at", "break_minutes", "note", "created_by", "updated_at"];

export const createShift = async (payload: Partial<IShiftAssignment>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("shift_assignments", payload, SHIFT_FIELDS, ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updateShift = async (id: number, payload: Partial<IShiftAssignment>): Promise<{ id: number } | undefined> => {
    const { query, values } = buildUpdateQuery(
        "shift_assignments",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        SHIFT_FIELDS,
        ["id"],
        true,
    );
    return (await db().query(query, values)).rows[0];
};

export const deleteShift = async (id: number): Promise<{ id: number } | undefined> => {
    return (await db().query("UPDATE shift_assignments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id", [id])).rows[0];
};

/** Ca khác của nhân viên chồng lấn khoảng [start, end) (bỏ qua các ca trong `excludeIds`) */
export const countOverlappingShifts = async (userId: number, start: Date, end: Date, excludeIds: number[] = []): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS n FROM shift_assignments
        WHERE user_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($4::int[]))
            AND tstzrange(start_at, end_at) && tstzrange($2::timestamptz, $3::timestamptz)`,
        [userId, start, end, excludeIds],
    );
    return result.rows[0].n;
};

/** Xóa (mềm) các ca chưa chấm công của nhân viên trong các ngày nghỉ phép đã duyệt */
export const deleteShiftsInRange = async (userId: number, from: string, to: string): Promise<number[]> => {
    const result = await db().query(
        `UPDATE shift_assignments sa SET deleted_at = NOW()
        WHERE sa.user_id = $1 AND sa.deleted_at IS NULL AND sa.work_date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.assignment_id = sa.id AND a.deleted_at IS NULL)
        RETURNING sa.id`,
        [userId, from, to],
    );
    return result.rows.map((r) => r.id);
};

/**
 * Ca để vào ca lúc `at`: đang diễn ra hoặc bắt đầu trong vòng `earlyMinutes` phút tới, chưa có chấm công.
 * Ưu tiên ca bắt đầu sớm nhất.
 */
export const findClockableShift = async (userId: number, at: Date, earlyMinutes: number): Promise<IShiftAssignment | undefined> => {
    const result = await db().query(
        `SELECT ${SHIFT_RETURNING.join(", ")} FROM shift_assignments sa
        WHERE sa.user_id = $1 AND sa.deleted_at IS NULL
            AND sa.start_at - make_interval(mins => $3::int) <= $2 AND sa.end_at > $2
            AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.assignment_id = sa.id AND a.deleted_at IS NULL)
        ORDER BY sa.start_at LIMIT 1`,
        [userId, at, earlyMinutes],
    );
    return result.rows[0];
};

export const getNextShift = async (userId: number, at: Date): Promise<IShiftAssignment | undefined> => {
    const result = await db().query(
        `SELECT ${SHIFT_RETURNING.join(", ")} FROM shift_assignments sa
        WHERE sa.user_id = $1 AND sa.deleted_at IS NULL AND sa.end_at > $2
            AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.assignment_id = sa.id AND a.deleted_at IS NULL)
        ORDER BY sa.start_at LIMIT 1`,
        [userId, at],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Đổi ca
// ---------------------------------------------------------------------------

const shiftJson = (col: string) =>
    `(SELECT json_build_object('work_date', to_char(s.work_date, 'YYYY-MM-DD'), 'start_at', s.start_at, 'end_at', s.end_at)
        FROM shift_assignments s WHERE s.id = ${col})`;

const SWAP_RETURNING = [
    "sw.*",
    userName("sw.requester_id", "requester_name"),
    userName("sw.target_user_id", "target_name"),
    userName("sw.decided_by", "decided_by_name"),
    `${shiftJson("sw.assignment_id")} AS shift`,
    `${shiftJson("sw.target_assignment_id")} AS target_shift`,
];

export const getSwaps = async (filter: {
    restaurantId: number | null;
    status?: string;
    /** Yêu cầu mà người này là người xin hoặc người nhận */
    userId?: number;
}): Promise<IShiftSwap[]> => {
    const result = await db().query(
        `SELECT ${SWAP_RETURNING.join(", ")} FROM shift_swap_requests sw
        WHERE ($1::int IS NULL OR sw.restaurant_id = $1::int)
            AND ($2::text IS NULL OR sw.status = $2)
            AND ($3::int IS NULL OR sw.requester_id = $3::int OR sw.target_user_id = $3::int)
        ORDER BY sw.created_at DESC LIMIT 200`,
        [filter.restaurantId, filter.status ?? null, filter.userId ?? null],
    );
    return result.rows;
};

export const getSwapById = async (id: number, forUpdate = false): Promise<IShiftSwap | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM shift_swap_requests WHERE id = $1 FOR UPDATE", [id]);
    return (await db().query(`SELECT ${SWAP_RETURNING.join(", ")} FROM shift_swap_requests sw WHERE sw.id = $1`, [id])).rows[0];
};

const SWAP_FIELDS = [
    "restaurant_id",
    "assignment_id",
    "requester_id",
    "target_user_id",
    "target_assignment_id",
    "status",
    "reason",
    "target_responded_at",
    "decided_by",
    "decided_at",
    "decision_note",
    "updated_at",
];

export const createSwap = async (payload: Partial<IShiftSwap>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("shift_swap_requests", payload, SWAP_FIELDS, ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updateSwap = async (id: number, payload: Partial<IShiftSwap>): Promise<void> => {
    const { query, values } = buildUpdateQuery("shift_swap_requests", { field: "id", value: id }, { ...payload, updated_at: new Date() }, SWAP_FIELDS, ["id"]);
    await db().query(query, values);
};

/** Yêu cầu đổi ca còn mở liên quan tới ca này (ở một trong hai phía) */
export const countOpenSwaps = async (assignmentId: number, excludeId?: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS n FROM shift_swap_requests
        WHERE status IN ('pending_target', 'pending_approval') AND (assignment_id = $1 OR target_assignment_id = $1)
            AND ($2::int IS NULL OR id <> $2::int)`,
        [assignmentId, excludeId ?? null],
    );
    return result.rows[0].n;
};

/** Hủy các yêu cầu đổi ca còn mở của ca (khi ca bị xóa / đổi người) */
export const cancelOpenSwaps = async (assignmentId: number): Promise<void> => {
    await db().query(
        `UPDATE shift_swap_requests SET status = 'cancelled', updated_at = NOW()
        WHERE status IN ('pending_target', 'pending_approval') AND (assignment_id = $1 OR target_assignment_id = $1)`,
        [assignmentId],
    );
};

// ---------------------------------------------------------------------------
// Chấm công
// ---------------------------------------------------------------------------

const ATTENDANCE_RETURNING = [
    "a.*",
    DATE("a.work_date"),
    "(SELECT u.full_name FROM users u WHERE u.id = a.user_id) AS full_name",
    "(SELECT s.start_at FROM shift_assignments s WHERE s.id = a.assignment_id) AS shift_start_at",
    "(SELECT s.end_at FROM shift_assignments s WHERE s.id = a.assignment_id) AS shift_end_at",
];

export const getAttendances = async (filter: {
    restaurantId: number | null;
    from: string;
    to: string;
    userId?: number;
    overtimeStatus?: string;
}): Promise<IAttendance[]> => {
    const result = await db().query(
        `SELECT ${ATTENDANCE_RETURNING.join(", ")} FROM attendance_records a
        WHERE a.deleted_at IS NULL AND a.work_date BETWEEN $1 AND $2
            AND ($3::int IS NULL OR a.restaurant_id = $3::int)
            AND ($4::int IS NULL OR a.user_id = $4::int)
            AND ($5::text IS NULL OR a.overtime_status = $5)
        ORDER BY a.clock_in_at DESC, a.id DESC`,
        [filter.from, filter.to, filter.restaurantId, filter.userId ?? null, filter.overtimeStatus ?? null],
    );
    return result.rows;
};

export const getAttendanceById = async (id: number, forUpdate = false): Promise<IAttendance | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM attendance_records WHERE id = $1 FOR UPDATE", [id]);
    const result = await db().query(`SELECT ${ATTENDANCE_RETURNING.join(", ")} FROM attendance_records a WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    return result.rows[0];
};

/** Lượt đang trong ca (chưa ra ca) của nhân viên */
export const getOpenAttendance = async (userId: number): Promise<IAttendance | undefined> => {
    const result = await db().query(
        `SELECT ${ATTENDANCE_RETURNING.join(", ")} FROM attendance_records a
        WHERE a.user_id = $1 AND a.clock_out_at IS NULL AND a.deleted_at IS NULL`,
        [userId],
    );
    return result.rows[0];
};

/** Các lượt khác của nhân viên chồng lấn khoảng [from, to) (to = NULL: chưa ra ca) */
export const countOverlappingAttendance = async (userId: number, from: Date, to: Date | null, excludeId?: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS n FROM attendance_records
        WHERE user_id = $1 AND deleted_at IS NULL AND ($4::int IS NULL OR id <> $4::int)
            AND tstzrange(clock_in_at, COALESCE(clock_out_at, 'infinity')) && tstzrange($2::timestamptz, COALESCE($3::timestamptz, 'infinity'))`,
        [userId, from, to, excludeId ?? null],
    );
    return result.rows[0].n;
};

const ATTENDANCE_FIELDS = [
    "restaurant_id",
    "user_id",
    "assignment_id",
    "work_date",
    "clock_in_at",
    "clock_out_at",
    "method",
    "late_minutes",
    "early_leave_minutes",
    "worked_minutes",
    "overtime_minutes",
    "overtime_status",
    "overtime_decided_by",
    "note",
    "created_by",
    "updated_at",
];

export const createAttendance = async (payload: Partial<IAttendance>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("attendance_records", payload, ATTENDANCE_FIELDS, ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updateAttendance = async (id: number, payload: Partial<IAttendance>): Promise<void> => {
    const { query, values } = buildUpdateQuery(
        "attendance_records",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        ATTENDANCE_FIELDS,
        ["id"],
        true,
    );
    await db().query(query, values);
};

export const deleteAttendance = async (id: number): Promise<void> => {
    await db().query("UPDATE attendance_records SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [id]);
};

// ---------------------------------------------------------------------------
// Nghỉ phép
// ---------------------------------------------------------------------------

const LEAVE_RETURNING = [
    "l.*",
    DATE("l.start_date"),
    DATE("l.end_date"),
    "(l.end_date - l.start_date + 1) AS days",
    "(SELECT u.full_name FROM users u WHERE u.id = l.user_id) AS full_name",
    userName("l.decided_by", "decided_by_name"),
];

export const getLeaves = async (filter: {
    restaurantId: number | null;
    status?: string;
    userId?: number;
    from?: string;
    to?: string;
}): Promise<ILeaveRequest[]> => {
    const result = await db().query(
        `SELECT ${LEAVE_RETURNING.join(", ")} FROM leave_requests l
        WHERE ($1::int IS NULL OR l.restaurant_id = $1::int)
            AND ($2::text IS NULL OR l.status = $2)
            AND ($3::int IS NULL OR l.user_id = $3::int)
            AND ($4::date IS NULL OR l.end_date >= $4::date)
            AND ($5::date IS NULL OR l.start_date <= $5::date)
        ORDER BY l.start_date DESC, l.id DESC LIMIT 300`,
        [filter.restaurantId, filter.status ?? null, filter.userId ?? null, filter.from ?? null, filter.to ?? null],
    );
    return result.rows;
};

export const getLeaveById = async (id: number, forUpdate = false): Promise<ILeaveRequest | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM leave_requests WHERE id = $1 FOR UPDATE", [id]);
    return (await db().query(`SELECT ${LEAVE_RETURNING.join(", ")} FROM leave_requests l WHERE l.id = $1`, [id])).rows[0];
};

export const countOverlappingLeaves = async (userId: number, start: string, end: string, excludeId?: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS n FROM leave_requests
        WHERE user_id = $1 AND status IN ('pending', 'approved') AND start_date <= $3 AND end_date >= $2
            AND ($4::int IS NULL OR id <> $4::int)`,
        [userId, start, end, excludeId ?? null],
    );
    return result.rows[0].n;
};

const LEAVE_FIELDS = ["restaurant_id", "user_id", "start_date", "end_date", "type", "reason", "status", "decided_by", "decided_at", "decision_note", "updated_at"];

export const createLeave = async (payload: Partial<ILeaveRequest>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("leave_requests", payload, LEAVE_FIELDS, ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updateLeave = async (id: number, payload: Partial<ILeaveRequest>): Promise<void> => {
    const { query, values } = buildUpdateQuery("leave_requests", { field: "id", value: id }, { ...payload, updated_at: new Date() }, LEAVE_FIELDS, ["id"]);
    await db().query(query, values);
};

// ---------------------------------------------------------------------------
// Lương, phụ cấp
// ---------------------------------------------------------------------------

export const getCompensations = async (userId: number): Promise<ICompensation[]> => {
    const result = await db().query(
        `SELECT c.*, ${DATE("c.effective_from")}, ${userName("c.created_by", "created_by_name")}
        FROM employee_compensations c WHERE c.user_id = $1 ORDER BY c.effective_from DESC`,
        [userId],
    );
    return result.rows;
};

/** Các mức lương của nhiều nhân viên có hiệu lực tới ngày `to` (mới nhất sau cùng) */
export const getCompensationsUpTo = async (userIds: number[], to: string): Promise<ICompensation[]> => {
    if (userIds.length === 0) return [];
    const result = await db().query(
        `SELECT c.*, ${DATE("c.effective_from")} FROM employee_compensations c
        WHERE c.user_id = ANY($1::int[]) AND c.effective_from <= $2 ORDER BY c.user_id, c.effective_from`,
        [userIds, to],
    );
    return result.rows;
};

export const createCompensation = async (payload: Partial<ICompensation>): Promise<ICompensation> => {
    const { query, values } = buildInsertQuery(
        "employee_compensations",
        payload,
        ["user_id", "pay_type", "amount", "effective_from", "note", "created_by"],
        ["*", DATE("effective_from")],
    );
    return (await db().query(query, values)).rows[0];
};

/** Mức lương hiện hành (ngày hôm nay) ghi lại vào `users.salary` để hiển thị ở danh sách nhân viên */
export const syncCurrentSalary = async (userId: number): Promise<void> => {
    await db().query(
        `UPDATE users SET salary = (
            SELECT c.amount FROM employee_compensations c
            WHERE c.user_id = $1 AND c.effective_from <= (now() AT TIME ZONE '${TZ}')::date
            ORDER BY c.effective_from DESC LIMIT 1
        ), updated_at = NOW() WHERE id = $1`,
        [userId],
    );
};

export const getAllowances = async (userId: number): Promise<IAllowance[]> => {
    const result = await db().query("SELECT * FROM employee_allowances WHERE user_id = $1 AND deleted_at IS NULL ORDER BY status, lower(name)", [userId]);
    return result.rows;
};

export const getActiveAllowances = async (userIds: number[]): Promise<IAllowance[]> => {
    if (userIds.length === 0) return [];
    const result = await db().query(
        "SELECT * FROM employee_allowances WHERE user_id = ANY($1::int[]) AND status = 'active' AND deleted_at IS NULL ORDER BY id",
        [userIds],
    );
    return result.rows;
};

export const getAllowanceById = async (id: number): Promise<IAllowance | undefined> => {
    return (await db().query("SELECT * FROM employee_allowances WHERE id = $1 AND deleted_at IS NULL", [id])).rows[0];
};

const ALLOWANCE_FIELDS = ["user_id", "name", "amount", "status", "created_by", "updated_at"];

export const createAllowance = async (payload: Partial<IAllowance> & { created_by?: number | null }): Promise<IAllowance> => {
    const { query, values } = buildInsertQuery("employee_allowances", payload, ALLOWANCE_FIELDS);
    return (await db().query(query, values)).rows[0];
};

export const updateAllowance = async (id: number, payload: Partial<IAllowance>): Promise<IAllowance | undefined> => {
    const { query, values } = buildUpdateQuery(
        "employee_allowances",
        { field: "id", value: id },
        { ...payload, user_id: undefined, updated_at: new Date() },
        ALLOWANCE_FIELDS,
        ["*"],
        true,
    );
    return (await db().query(query, values)).rows[0];
};

export const deleteAllowance = async (id: number): Promise<{ id: number } | undefined> => {
    return (await db().query("UPDATE employee_allowances SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id", [id])).rows[0];
};

// ---------------------------------------------------------------------------
// Thưởng / phạt
// ---------------------------------------------------------------------------

const ADJUSTMENT_RETURNING = [
    "ad.*",
    DATE("ad.effective_date"),
    "(SELECT u.full_name FROM users u WHERE u.id = ad.user_id) AS full_name",
    userName("ad.created_by", "created_by_name"),
];

export const getAdjustments = async (filter: { restaurantId: number | null; from: string; to: string; userId?: number }): Promise<IAdjustment[]> => {
    const result = await db().query(
        `SELECT ${ADJUSTMENT_RETURNING.join(", ")} FROM employee_adjustments ad
        WHERE ad.deleted_at IS NULL AND ad.effective_date BETWEEN $1 AND $2
            AND ($3::int IS NULL OR ad.restaurant_id = $3::int)
            AND ($4::int IS NULL OR ad.user_id = $4::int)
        ORDER BY ad.effective_date DESC, ad.id DESC`,
        [filter.from, filter.to, filter.restaurantId, filter.userId ?? null],
    );
    return result.rows;
};

export const getAdjustmentById = async (id: number): Promise<IAdjustment | undefined> => {
    return (await db().query(`SELECT ${ADJUSTMENT_RETURNING.join(", ")} FROM employee_adjustments ad WHERE ad.id = $1 AND ad.deleted_at IS NULL`, [id])).rows[0];
};

export const getAdjustmentByAttendance = async (attendanceId: number): Promise<IAdjustment | undefined> => {
    const result = await db().query(
        `SELECT ${ADJUSTMENT_RETURNING.join(", ")} FROM employee_adjustments ad WHERE ad.attendance_id = $1 AND ad.deleted_at IS NULL`,
        [attendanceId],
    );
    return result.rows[0];
};

export const createAdjustment = async (payload: Partial<IAdjustment>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery(
        "employee_adjustments",
        payload,
        ["restaurant_id", "user_id", "type", "amount", "reason", "effective_date", "source", "attendance_id", "created_by"],
        ["id"],
    );
    return (await db().query(query, values)).rows[0];
};

export const deleteAdjustment = async (id: number): Promise<void> => {
    await db().query("UPDATE employee_adjustments SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [id]);
};

/** Gắn các khoản thưởng / phạt vào bảng lương khi chốt (từ đó không sửa / xóa được) */
export const lockAdjustments = async (ids: number[], payrollId: number): Promise<void> => {
    if (ids.length === 0) return;
    await db().query("UPDATE employee_adjustments SET payroll_id = $2, updated_at = NOW() WHERE id = ANY($1::int[])", [ids, payrollId]);
};

// ---------------------------------------------------------------------------
// Bảng lương
// ---------------------------------------------------------------------------

const PAYROLL_RETURNING = [
    "p.*",
    DATE("p.period_month"),
    "(SELECT r.name FROM restaurants r WHERE r.id = p.restaurant_id) AS restaurant_name",
    userName("p.finalized_by", "finalized_by_name"),
];

export const getPayrolls = async (restaurantId: number | null, year?: number): Promise<IPayroll[]> => {
    const result = await db().query(
        `SELECT ${PAYROLL_RETURNING.join(", ")} FROM payroll_periods p
        WHERE ($1::int IS NULL OR p.restaurant_id = $1::int) AND ($2::int IS NULL OR extract(year FROM p.period_month) = $2::int)
        ORDER BY p.period_month DESC, p.restaurant_id`,
        [restaurantId, year ?? null],
    );
    return result.rows;
};

export const getPayrollById = async (id: number, forUpdate = false): Promise<IPayroll | undefined> => {
    if (forUpdate) await db().query("SELECT id FROM payroll_periods WHERE id = $1 FOR UPDATE", [id]);
    return (await db().query(`SELECT ${PAYROLL_RETURNING.join(", ")} FROM payroll_periods p WHERE p.id = $1`, [id])).rows[0];
};

/** Bảng lương của tháng (khóa dòng để tính lại tuần tự) */
export const getPayrollByMonth = async (restaurantId: number, month: string, forUpdate = false): Promise<IPayroll | undefined> => {
    const result = await db().query(
        `SELECT ${PAYROLL_RETURNING.join(", ")} FROM payroll_periods p WHERE p.restaurant_id = $1 AND p.period_month = $2${forUpdate ? " FOR UPDATE OF p" : ""}`,
        [restaurantId, month],
    );
    return result.rows[0];
};

export const createPayroll = async (payload: Partial<IPayroll>): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("payroll_periods", payload, ["restaurant_id", "period_month", "note", "created_by"], ["id"]);
    return (await db().query(query, values)).rows[0];
};

export const updatePayroll = async (id: number, payload: Partial<IPayroll>): Promise<void> => {
    const { query, values } = buildUpdateQuery(
        "payroll_periods",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        ["status", "total_net", "labor_cost", "employee_count", "note", "calculated_at", "finalized_by", "finalized_at", "created_by", "updated_at"],
        ["id"],
    );
    await db().query(query, values);
};

export const deletePayrollItems = async (payrollId: number): Promise<void> => {
    await db().query("DELETE FROM payroll_items WHERE payroll_id = $1", [payrollId]);
};

export const insertPayrollItems = async (payrollId: number, items: Omit<IPayrollItem, "id" | "payroll_id">[]): Promise<void> => {
    if (items.length === 0) return;
    await db().query(
        `INSERT INTO payroll_items (payroll_id, user_id, full_name, pay_type, rate, work_days, paid_leave_days, unpaid_leave_days,
            worked_minutes, overtime_minutes, late_count, base_pay, overtime_pay, allowance_total, bonus_total, penalty_total,
            tip_total, net_pay, details)
        SELECT $1, x.user_id, x.full_name, x.pay_type, x.rate, x.work_days, x.paid_leave_days, x.unpaid_leave_days,
            x.worked_minutes, x.overtime_minutes, x.late_count, x.base_pay, x.overtime_pay, x.allowance_total, x.bonus_total,
            x.penalty_total, x.tip_total, x.net_pay, x.details
        FROM jsonb_to_recordset($2::jsonb) AS x(user_id int, full_name text, pay_type text, rate numeric, work_days int,
            paid_leave_days int, unpaid_leave_days int, worked_minutes int, overtime_minutes int, late_count int, base_pay numeric,
            overtime_pay numeric, allowance_total numeric, bonus_total numeric, penalty_total numeric, tip_total numeric,
            net_pay numeric, details jsonb)`,
        [payrollId, JSON.stringify(items)],
    );
};

export const getPayrollItems = async (payrollId: number): Promise<IPayrollItem[]> => {
    return (await db().query("SELECT * FROM payroll_items WHERE payroll_id = $1 ORDER BY lower(full_name), user_id", [payrollId])).rows;
};

/** Phiếu lương của một nhân viên trong các bảng lương đã chốt */
export const getMyPayslips = async (userId: number): Promise<(IPayrollItem & { period_month: string; restaurant_name: string })[]> => {
    const result = await db().query(
        `SELECT i.*, to_char(p.period_month, 'YYYY-MM-DD') AS period_month, r.name AS restaurant_name, p.finalized_at
        FROM payroll_items i JOIN payroll_periods p ON p.id = i.payroll_id AND p.status = 'finalized'
        JOIN restaurants r ON r.id = p.restaurant_id
        WHERE i.user_id = $1 ORDER BY p.period_month DESC LIMIT 24`,
        [userId],
    );
    return result.rows;
};

// ---------------------------------------------------------------------------
// Số liệu tính lương của một tháng
// ---------------------------------------------------------------------------

/** Lượt chấm công đã ra ca trong tháng của chi nhánh */
export const getClosedAttendance = async (restaurantId: number, from: string, to: string): Promise<IAttendance[]> => {
    const result = await db().query(
        `SELECT a.*, ${DATE("a.work_date")} FROM attendance_records a
        WHERE a.restaurant_id = $1 AND a.deleted_at IS NULL AND a.clock_out_at IS NOT NULL AND a.work_date BETWEEN $2 AND $3
        ORDER BY a.work_date`,
        [restaurantId, from, to],
    );
    return result.rows;
};

export const getApprovedLeaves = async (restaurantId: number, from: string, to: string): Promise<ILeaveRequest[]> => {
    return getLeaves({ restaurantId, status: "approved", from, to });
};

/** Tip theo nhân viên phụ trách (đặc tả GĐ9): payment đã thu trong khoảng, theo giờ Việt Nam */
export const getTipsByStaff = async (restaurantId: number, from: string, to: string): Promise<Map<number, number>> => {
    const result = await db().query(
        `SELECT p.tip_staff_id AS user_id, SUM(p.tip_amount) AS total FROM payments p
        WHERE p.type = 'payment' AND p.status IN ('paid', 'refunded') AND p.tip_amount > 0 AND p.tip_staff_id IS NOT NULL
            AND p.restaurant_id = $1
            AND p.paid_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND p.paid_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY p.tip_staff_id`,
        [restaurantId, from, to],
    );
    return new Map(result.rows.map((r) => [r.user_id, Number(r.total)]));
};

/** Nhân viên có số liệu trong tháng ở chi nhánh (đã chuyển chi nhánh / đã nghỉ vẫn được tính) */
export const getUsersWithActivity = async (restaurantId: number, from: string, to: string): Promise<number[]> => {
    const result = await db().query(
        `SELECT user_id FROM attendance_records WHERE restaurant_id = $1 AND deleted_at IS NULL AND work_date BETWEEN $2 AND $3
        UNION SELECT user_id FROM employee_adjustments WHERE restaurant_id = $1 AND deleted_at IS NULL AND effective_date BETWEEN $2 AND $3
        UNION SELECT user_id FROM leave_requests WHERE restaurant_id = $1 AND status = 'approved' AND start_date <= $3 AND end_date >= $2
        UNION SELECT tip_staff_id FROM payments WHERE restaurant_id = $1 AND tip_amount > 0 AND tip_staff_id IS NOT NULL
            AND type = 'payment' AND status IN ('paid', 'refunded')
            AND paid_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND paid_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')`,
        [restaurantId, from, to],
    );
    return result.rows.map((r) => r.user_id);
};

// ---------------------------------------------------------------------------
// Đánh giá và hiệu suất
// ---------------------------------------------------------------------------

export const getReviews = async (restaurantId: number, month: string): Promise<IStaffReview[]> => {
    const result = await db().query(
        `SELECT rv.*, ${DATE("rv.period_month")}, ${userName("rv.reviewer_id", "reviewer_name")}
        FROM employee_reviews rv WHERE rv.restaurant_id = $1 AND rv.period_month = $2`,
        [restaurantId, month],
    );
    return result.rows;
};

export const upsertReview = async (payload: {
    restaurant_id: number;
    user_id: number;
    period_month: string;
    rating: number;
    comment: string | null;
    reviewer_id: number | null;
}): Promise<IStaffReview> => {
    const result = await db().query(
        `INSERT INTO employee_reviews (restaurant_id, user_id, period_month, rating, comment, reviewer_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, period_month) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment,
            reviewer_id = EXCLUDED.reviewer_id, restaurant_id = EXCLUDED.restaurant_id, updated_at = NOW()
        RETURNING *, ${DATE("period_month")}`,
        [payload.restaurant_id, payload.user_id, payload.period_month, payload.rating, payload.comment, payload.reviewer_id],
    );
    return result.rows[0];
};

/** Số liệu hiệu suất theo nhân viên của chi nhánh trong khoảng ngày */
export const getPerformanceStats = async (restaurantId: number, from: string, to: string) => {
    const result = await db().query(
        `WITH att AS (
            SELECT user_id, COUNT(DISTINCT work_date)::int AS work_days, COALESCE(SUM(worked_minutes), 0)::int AS worked_minutes,
                COALESCE(SUM(overtime_minutes) FILTER (WHERE overtime_status = 'approved'), 0)::int AS overtime_minutes,
                COUNT(*) FILTER (WHERE late_minutes > 0)::int AS late_count, COALESCE(SUM(late_minutes), 0)::int AS late_minutes,
                COUNT(*) FILTER (WHERE early_leave_minutes > 0)::int AS early_leave_count
            FROM attendance_records WHERE restaurant_id = $1 AND deleted_at IS NULL AND work_date BETWEEN $2 AND $3 GROUP BY user_id
        ), sh AS (
            SELECT sa.user_id, COUNT(*)::int AS scheduled_shifts,
                COUNT(*) FILTER (WHERE sa.end_at < now() AND NOT EXISTS (
                    SELECT 1 FROM attendance_records a WHERE a.assignment_id = sa.id AND a.deleted_at IS NULL))::int AS absent_shifts
            FROM shift_assignments sa WHERE sa.restaurant_id = $1 AND sa.deleted_at IS NULL AND sa.work_date BETWEEN $2 AND $3
            GROUP BY sa.user_id
        ), lv AS (
            SELECT user_id, SUM(LEAST(end_date, $3::date) - GREATEST(start_date, $2::date) + 1)::int AS leave_days
            FROM leave_requests WHERE restaurant_id = $1 AND status = 'approved' AND start_date <= $3 AND end_date >= $2 GROUP BY user_id
        ), od AS (
            SELECT assigned_staff_id AS user_id, COUNT(*)::int AS orders_served FROM orders
            WHERE restaurant_id = $1 AND deleted_at IS NULL AND status = 'completed' AND assigned_staff_id IS NOT NULL
                AND completed_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND completed_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
            GROUP BY assigned_staff_id
        ), tp AS (
            SELECT tip_staff_id AS user_id, SUM(tip_amount) AS tip_total FROM payments
            WHERE restaurant_id = $1 AND tip_amount > 0 AND type = 'payment' AND status IN ('paid', 'refunded') AND tip_staff_id IS NOT NULL
                AND paid_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND paid_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
            GROUP BY tip_staff_id
        ), ad AS (
            SELECT user_id, COALESCE(SUM(amount) FILTER (WHERE type = 'bonus'), 0) AS bonus_total,
                COALESCE(SUM(amount) FILTER (WHERE type = 'penalty'), 0) AS penalty_total
            FROM employee_adjustments WHERE restaurant_id = $1 AND deleted_at IS NULL AND effective_date BETWEEN $2 AND $3 GROUP BY user_id
        )
        SELECT x.user_id,
            COALESCE(sh.scheduled_shifts, 0) AS scheduled_shifts, COALESCE(sh.absent_shifts, 0) AS absent_shifts,
            COALESCE(att.work_days, 0) AS work_days, COALESCE(att.worked_minutes, 0) AS worked_minutes,
            COALESCE(att.overtime_minutes, 0) AS overtime_minutes, COALESCE(att.late_count, 0) AS late_count,
            COALESCE(att.late_minutes, 0) AS late_minutes, COALESCE(att.early_leave_count, 0) AS early_leave_count,
            COALESCE(lv.leave_days, 0) AS leave_days, COALESCE(od.orders_served, 0) AS orders_served,
            COALESCE(tp.tip_total, 0) AS tip_total, COALESCE(ad.bonus_total, 0) AS bonus_total, COALESCE(ad.penalty_total, 0) AS penalty_total
        FROM (SELECT user_id FROM att UNION SELECT user_id FROM sh UNION SELECT user_id FROM lv UNION SELECT user_id FROM od
            UNION SELECT user_id FROM tp UNION SELECT user_id FROM ad) x
        LEFT JOIN att ON att.user_id = x.user_id LEFT JOIN sh ON sh.user_id = x.user_id LEFT JOIN lv ON lv.user_id = x.user_id
        LEFT JOIN od ON od.user_id = x.user_id LEFT JOIN tp ON tp.user_id = x.user_id LEFT JOIN ad ON ad.user_id = x.user_id`,
        [restaurantId, from, to],
    );
    return result.rows as {
        user_id: number;
        scheduled_shifts: number;
        absent_shifts: number;
        work_days: number;
        worked_minutes: number;
        overtime_minutes: number;
        late_count: number;
        late_minutes: number;
        early_leave_count: number;
        leave_days: number;
        orders_served: number;
        tip_total: string;
        bonus_total: string;
        penalty_total: string;
    }[];
};

// ---------------------------------------------------------------------------
// Chi phí nhân công (báo cáo lợi nhuận)
// ---------------------------------------------------------------------------

/** Bảng lương các tháng giao với khoảng [from, to] */
export const getPayrollCosts = async (from: string, to: string, restaurantId: number | null) => {
    const result = await db().query(
        `SELECT p.restaurant_id, to_char(p.period_month, 'YYYY-MM-DD') AS period_month, p.status, p.labor_cost
        FROM payroll_periods p
        WHERE p.period_month <= $2::date AND (p.period_month + interval '1 month' - interval '1 day')::date >= $1::date
            AND ($3::int IS NULL OR p.restaurant_id = $3::int)`,
        [from, to, restaurantId],
    );
    return result.rows as { restaurant_id: number; period_month: string; status: string; labor_cost: string }[];
};

/** Hoán đổi người của hai ca: hoãn kiểm tra chồng lấn tới cuối transaction */
export const deferShiftOverlapCheck = async (): Promise<void> => {
    await db().query("SET CONSTRAINTS shift_assignments_no_overlap DEFERRED");
};

export const updateCompensationAmount = async (id: number, amount: number): Promise<void> => {
    await db().query("UPDATE employee_compensations SET amount = $2 WHERE id = $1", [id, amount]);
};

/** Khóa advisory theo chi nhánh + tháng khi tính bảng lương */
export const lockPayrollMonth = async (restaurantId: number, month: string): Promise<void> => {
    await db().query("SELECT pg_advisory_xact_lock(hashtext($1), $2)", [`payroll_${month}`, restaurantId]);
};
