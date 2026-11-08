import { createHmac, timingSafeEqual } from "crypto";
import { AdjustmentTypeEnum, OvertimeStatusEnum } from "~/common/enum";
import { HR_ERROR } from "~/common/error-code/hr";
import { db, rollback, withTransaction } from "~/config/db";
import {
    HrScope,
    IAttendance,
    IAuditContext,
    IClockResult,
    IHrActor,
    IHrSettingsRow,
    IManualAttendanceBody,
    IMyHrStatus,
    IShiftAssignment,
    IUpdateAttendanceBody,
} from "~/interfaces";
import { hrRepository } from "~/repositories";
import { diffChanges, writeAudit } from "~/utils/audit";
import { minutesBetween, monthRange, vnDate } from "~/utils/hr-time";
import { checkTarget, inScope, isPayrollLocked, resolveRestaurant } from "./hr-access";

/**
 * Giai đoạn 12: chấm công. Nhân viên quét mã QR xoay vòng của chi nhánh (hiển thị trên thiết bị của nhà hàng) để vào / ra ca;
 * quản lý sửa tay khi cần (có nhật ký). Đi muộn / về sớm so với ca đã xếp, giờ ngoài ca là tăng ca chờ duyệt.
 */

/** Mỗi mã QR có hiệu lực trong một khung 30 giây; chấp nhận thêm 2 khung trước (quét chậm, đồng hồ lệch) */
export const QR_PERIOD_SECONDS = 30;
const QR_GRACE_WINDOWS = 2;

const sign = (secret: string, restaurantId: number, window: number) =>
    createHmac("sha256", secret).update(`${restaurantId}.${window}`).digest("base64url").slice(0, 22);

const currentWindow = (at = Date.now()) => Math.floor(at / (QR_PERIOD_SECONDS * 1000));

/** Mã hiển thị trên màn hình chấm công của chi nhánh: "<restaurantId>.<khung thời gian>.<chữ ký>" */
export const getQrToken = async (
    scope: HrScope,
    restaurantId?: number,
): Promise<{ restaurant_id: number; token: string; expires_at: string; period_seconds: number } | number> => {
    try {
        const r = await resolveRestaurant(scope, restaurantId);
        if (typeof r === "number") return r;
        const settings = await hrRepository.getSettings(r.id);
        const window = currentWindow();
        return {
            restaurant_id: r.id,
            token: `${r.id}.${window}.${sign(settings.qr_secret, r.id, window)}`,
            expires_at: new Date((window + 1) * QR_PERIOD_SECONDS * 1000).toISOString(),
            period_seconds: QR_PERIOD_SECONDS,
        };
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Kiểm tra mã QR: đúng chi nhánh của nhân viên, đúng chữ ký, còn hạn */
const verifyQr = async (token: string, restaurantId: number): Promise<boolean> => {
    const [rid, win, sig] = token.split(".");
    const window = Number(win);
    if (Number(rid) !== restaurantId || !Number.isInteger(window) || !sig) return false;
    const now = currentWindow();
    if (window > now || window < now - QR_GRACE_WINDOWS) return false;
    const settings = await hrRepository.getSettings(restaurantId);
    const expected = Buffer.from(sign(settings.qr_secret, restaurantId, window));
    const actual = Buffer.from(sig);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// ---------------------------------------------------------------------------
// Tính đi muộn, về sớm, giờ làm, tăng ca
// ---------------------------------------------------------------------------

type Shift = Pick<IShiftAssignment, "start_at" | "end_at" | "break_minutes">;

/**
 * - Đi muộn: vào sau giờ bắt đầu ca quá số phút ân hạn -> ghi đủ số phút muộn.
 * - Về sớm: ra trước giờ kết thúc ca quá số phút ân hạn.
 * - Giờ làm = thời gian vào -> ra, trừ giờ nghỉ của ca (không quá phần thời gian nằm trong ca).
 * - Tăng ca: phần thời gian ngoài ca (vào sớm + ra muộn) từ ngưỡng trở lên; không có ca thì cả lượt là tăng ca. Chờ duyệt.
 */
export const computeMetrics = (clockIn: Date, clockOut: Date | null, shift: Shift | null, settings: IHrSettingsRow) => {
    const start = shift ? new Date(shift.start_at) : null;
    const end = shift ? new Date(shift.end_at) : null;
    const lateBy = start ? minutesBetween(start, clockIn) : 0;
    const late_minutes = lateBy > settings.late_grace_minutes ? lateBy : 0;
    if (!clockOut) return { late_minutes, early_leave_minutes: 0, worked_minutes: 0, overtime_minutes: 0 };
    const gross = Math.max(0, minutesBetween(clockIn, clockOut));
    if (!start || !end) return { late_minutes: 0, early_leave_minutes: 0, worked_minutes: gross, overtime_minutes: gross };
    const earlyBy = minutesBetween(clockOut, end);
    const early_leave_minutes = earlyBy > settings.early_leave_grace_minutes ? earlyBy : 0;
    const inside = Math.max(0, minutesBetween(clockIn > start ? clockIn : start, clockOut < end ? clockOut : end));
    const outside = gross - inside;
    const worked_minutes = gross - Math.min(shift!.break_minutes, inside);
    const overtime_minutes = outside >= Math.max(1, settings.overtime_threshold_minutes) ? outside : 0;
    return { late_minutes, early_leave_minutes, worked_minutes, overtime_minutes };
};

/** Trạng thái tăng ca sau khi tính lại: giữ kết quả duyệt nếu số phút không đổi */
const overtimeStatus = (minutes: number, previous?: Pick<IAttendance, "overtime_minutes" | "overtime_status">) => {
    if (minutes <= 0) return OvertimeStatusEnum.NONE;
    if (previous && previous.overtime_minutes === minutes && previous.overtime_status !== OvertimeStatusEnum.NONE) return previous.overtime_status;
    return OvertimeStatusEnum.PENDING;
};

/** Phạt đi muộn tự động theo cấu hình chi nhánh (một khoản cho mỗi lượt muộn). Khoản đã vào bảng lương chốt thì giữ nguyên. */
const syncLatePenalty = async (record: IAttendance, settings: IHrSettingsRow, actorId: number | null) => {
    const existing = await hrRepository.getAdjustmentByAttendance(record.id);
    if (existing?.payroll_id) return;
    const amount = Number(settings.late_penalty_amount);
    const wanted = record.late_minutes > 0 && amount > 0;
    if (existing && (!wanted || Number(existing.amount) !== amount)) await hrRepository.deleteAdjustment(existing.id);
    if (wanted && (!existing || Number(existing.amount) !== amount)) {
        await hrRepository.createAdjustment({
            restaurant_id: record.restaurant_id,
            user_id: record.user_id,
            type: AdjustmentTypeEnum.PENALTY,
            amount,
            reason: `Đi muộn ${record.late_minutes} phút (${record.work_date})`,
            effective_date: record.work_date,
            source: "late",
            attendance_id: record.id,
            created_by: actorId,
        });
    }
};

const lockUser = (userId: number) => db().query("SELECT pg_advisory_xact_lock(hashtext('attendance'), $1)", [userId]);

// ---------------------------------------------------------------------------
// Nhân viên tự chấm công
// ---------------------------------------------------------------------------

/**
 * Quét mã QR: chưa vào ca thì vào ca (gắn với ca đang diễn ra / sắp bắt đầu), đang trong ca thì ra ca.
 * Ngày công là ngày của ca (hoặc ngày vào ca nếu không có ca).
 */
export const clock = async (user: { id: number; restaurant_id: number | null }, token: string, audit: IAuditContext): Promise<IClockResult | number> => {
    try {
        if (!user.restaurant_id) return HR_ERROR.RESTAURANT_REQUIRED;
        if (!(await verifyQr(token, user.restaurant_id))) return HR_ERROR.QR_INVALID;
        return await withTransaction(async () => {
            await lockUser(user.id);
            const settings = await hrRepository.getSettings(user.restaurant_id!);
            const now = new Date();
            const open = await hrRepository.getOpenAttendance(user.id);
            if (open) {
                const shift = open.assignment_id ? await hrRepository.getShiftById(open.assignment_id) : null;
                const metrics = computeMetrics(new Date(open.clock_in_at), now, shift ?? null, settings);
                await hrRepository.updateAttendance(open.id, { clock_out_at: now, ...metrics, overtime_status: overtimeStatus(metrics.overtime_minutes) });
                return { action: "clock_out" as const, attendance: (await hrRepository.getAttendanceById(open.id))! };
            }
            const shift = await hrRepository.findClockableShift(user.id, now, settings.early_clock_in_minutes);
            const metrics = computeMetrics(now, null, shift ?? null, settings);
            const { id } = await hrRepository.createAttendance({
                restaurant_id: user.restaurant_id!,
                user_id: user.id,
                assignment_id: shift?.id ?? null,
                work_date: shift?.work_date ?? vnDate(now),
                clock_in_at: now,
                method: "qr",
                late_minutes: metrics.late_minutes,
                created_by: user.id,
            });
            const record = (await hrRepository.getAttendanceById(id))!;
            await syncLatePenalty(record, settings, audit.userId ?? user.id);
            return { action: "clock_in" as const, attendance: record };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getMyStatus = async (userId: number): Promise<IMyHrStatus | number> => {
    try {
        const [open, next] = await Promise.all([hrRepository.getOpenAttendance(userId), hrRepository.getNextShift(userId, new Date())]);
        return { open_attendance: open ?? null, next_shift: next ?? null };
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getMyAttendance = async (userId: number, month: string): Promise<IAttendance[] | number> => {
    try {
        const { start, end } = monthRange(month);
        return await hrRepository.getAttendances({ restaurantId: null, from: start, to: end, userId });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Quản lý
// ---------------------------------------------------------------------------

export const getAttendances = async (
    scope: HrScope,
    query: { restaurant_id?: number; from: string; to: string; user_id?: number; overtime_status?: string },
): Promise<IAttendance[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        return await hrRepository.getAttendances({
            restaurantId: r.id,
            from: query.from,
            to: query.to,
            userId: query.user_id,
            overtimeStatus: query.overtime_status,
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Ca được gắn khi ghi tay: phải là ca của đúng nhân viên, chưa có chấm công khác */
const loadShiftFor = async (assignmentId: number, userId: number, excludeAttendance?: number) => {
    const shift = await hrRepository.getShiftById(assignmentId);
    if (!shift || shift.user_id !== userId || (shift.attendance_id && shift.attendance_id !== excludeAttendance)) return undefined;
    return shift;
};

/** Quản lý ghi tay một lượt chấm công (nhân viên quên quét mã). Không ghi cho chính mình. */
export const createManual = async (body: IManualAttendanceBody, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<IAttendance | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const target = await checkTarget(body.user_id, r.id, actor);
            if (typeof target === "number") return rollback(target);
            await lockUser(body.user_id);
            const clockIn = new Date(body.clock_in_at);
            const clockOut = body.clock_out_at ? new Date(body.clock_out_at) : null;
            if (clockOut && clockOut <= clockIn) return rollback(HR_ERROR.ATTENDANCE_INVALID);
            const shift = body.assignment_id ? await loadShiftFor(body.assignment_id, body.user_id) : null;
            if (body.assignment_id && !shift) return rollback(HR_ERROR.SHIFT_NOT_FOUND);
            const workDate = shift?.work_date ?? vnDate(clockIn);
            if (await isPayrollLocked(r.id, workDate)) return rollback(HR_ERROR.PAYROLL_LOCKED);
            if (await hrRepository.countOverlappingAttendance(body.user_id, clockIn, clockOut)) return rollback(HR_ERROR.ATTENDANCE_INVALID);
            const settings = await hrRepository.getSettings(r.id);
            const metrics = computeMetrics(clockIn, clockOut, shift ?? null, settings);
            const { id } = await hrRepository.createAttendance({
                restaurant_id: r.id,
                user_id: body.user_id,
                assignment_id: shift?.id ?? null,
                work_date: workDate,
                clock_in_at: clockIn,
                clock_out_at: clockOut,
                method: "manual",
                ...metrics,
                overtime_status: overtimeStatus(metrics.overtime_minutes),
                note: body.note ?? null,
                created_by: actor.userId,
            });
            const record = (await hrRepository.getAttendanceById(id))!;
            await syncLatePenalty(record, settings, actor.userId);
            await writeAudit(audit, { action: "attendance.manual_create", entity_type: "attendance", entity_id: id, restaurant_id: r.id, after: record });
            return record;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Sửa giờ vào / ra (tính lại đi muộn, giờ làm, tăng ca và phạt đi muộn tự động) */
export const updateAttendance = async (
    id: number,
    body: IUpdateAttendanceBody,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<IAttendance | number> => {
    try {
        return await withTransaction(async () => {
            const record = await hrRepository.getAttendanceById(id, true);
            if (!record || !inScope(record.restaurant_id, scope)) return rollback(HR_ERROR.ATTENDANCE_NOT_FOUND);
            const target = await checkTarget(record.user_id, null, actor);
            if (typeof target === "number") return rollback(target);
            if (await isPayrollLocked(record.restaurant_id, record.work_date)) return rollback(HR_ERROR.PAYROLL_LOCKED);
            const clockIn = body.clock_in_at ? new Date(body.clock_in_at) : new Date(record.clock_in_at);
            const clockOut = body.clock_out_at === undefined ? (record.clock_out_at ? new Date(record.clock_out_at) : null) : body.clock_out_at ? new Date(body.clock_out_at) : null;
            if (clockOut && clockOut <= clockIn) return rollback(HR_ERROR.ATTENDANCE_INVALID);
            if (await hrRepository.countOverlappingAttendance(record.user_id, clockIn, clockOut, id)) return rollback(HR_ERROR.ATTENDANCE_INVALID);
            const shift = record.assignment_id ? await hrRepository.getShiftById(record.assignment_id) : null;
            const settings = await hrRepository.getSettings(record.restaurant_id);
            const metrics = computeMetrics(clockIn, clockOut, shift ?? null, settings);
            await hrRepository.updateAttendance(id, {
                clock_in_at: clockIn,
                clock_out_at: clockOut,
                method: "manual",
                ...metrics,
                overtime_status: overtimeStatus(metrics.overtime_minutes, record),
                overtime_decided_by: overtimeStatus(metrics.overtime_minutes, record) === record.overtime_status ? record.overtime_decided_by : null,
                note: body.note === undefined ? record.note : body.note,
            });
            const updated = (await hrRepository.getAttendanceById(id))!;
            await syncLatePenalty(updated, settings, actor.userId);
            await writeAudit(audit, { action: "attendance.update", entity_type: "attendance", entity_id: id, restaurant_id: record.restaurant_id, ...diffChanges(record, updated) });
            return updated;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const deleteAttendance = async (id: number, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            const record = await hrRepository.getAttendanceById(id, true);
            if (!record || !inScope(record.restaurant_id, scope)) return rollback(HR_ERROR.ATTENDANCE_NOT_FOUND);
            const target = await checkTarget(record.user_id, null, actor);
            if (typeof target === "number") return rollback(target);
            if (await isPayrollLocked(record.restaurant_id, record.work_date)) return rollback(HR_ERROR.PAYROLL_LOCKED);
            const penalty = await hrRepository.getAdjustmentByAttendance(id);
            if (penalty && !penalty.payroll_id) await hrRepository.deleteAdjustment(penalty.id);
            await hrRepository.deleteAttendance(id);
            await writeAudit(audit, { action: "attendance.delete", entity_type: "attendance", entity_id: id, restaurant_id: record.restaurant_id, before: record });
            return { id };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Duyệt / từ chối tăng ca. Chỉ tăng ca đã duyệt mới được tính lương. */
export const decideOvertime = async (
    id: number,
    approve: boolean,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<IAttendance | number> => {
    try {
        return await withTransaction(async () => {
            const record = await hrRepository.getAttendanceById(id, true);
            if (!record || !inScope(record.restaurant_id, scope)) return rollback(HR_ERROR.ATTENDANCE_NOT_FOUND);
            if (record.overtime_minutes <= 0 || !record.clock_out_at) return rollback(HR_ERROR.NO_OVERTIME);
            const target = await checkTarget(record.user_id, null, actor);
            if (typeof target === "number") return rollback(target);
            if (await isPayrollLocked(record.restaurant_id, record.work_date)) return rollback(HR_ERROR.PAYROLL_LOCKED);
            const status = approve ? OvertimeStatusEnum.APPROVED : OvertimeStatusEnum.REJECTED;
            await hrRepository.updateAttendance(id, { overtime_status: status, overtime_decided_by: actor.userId });
            await writeAudit(audit, {
                action: approve ? "attendance.overtime_approve" : "attendance.overtime_reject",
                entity_type: "attendance",
                entity_id: id,
                restaurant_id: record.restaurant_id,
                before: { overtime_status: record.overtime_status },
                after: { overtime_status: status, overtime_minutes: record.overtime_minutes, user_id: record.user_id },
            });
            return (await hrRepository.getAttendanceById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};
