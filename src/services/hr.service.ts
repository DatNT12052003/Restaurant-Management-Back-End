import { LeaveStatusEnum, ShiftSwapStatusEnum } from "~/common/enum";
import { HR_ERROR } from "~/common/error-code/hr";
import { rollback, withTransaction } from "~/config/db";
import {
    HrScope,
    IAuditContext,
    ICreateShiftsBody,
    IHrActor,
    IHrSettings,
    IHrSettingsBody,
    ILeaveRequest,
    IShiftAssignment,
    IShiftSwap,
    IShiftTemplate,
    IShiftTemplateBody,
    IStaffMember,
    IStaffPerformance,
    IStaffReview,
    IUpdateShiftBody,
} from "~/interfaces";
import { hrRepository } from "~/repositories";
import { diffChanges, writeAudit } from "~/utils/audit";
import { addDays, daysBetween, eachDay, monthRange, shiftWindow } from "~/utils/hr-time";
import { checkTarget, inScope, isPayrollLocked, pgCode, PG_EXCLUSION, PG_UNIQUE, resolveRestaurant } from "./hr-access";

/** Giai đoạn 12: cấu hình nhân sự, ca làm, đổi ca, nghỉ phép, đánh giá. Chấm công ở attendance.service, lương ở payroll.service. */

const S = ShiftSwapStatusEnum;
const OPEN_SWAP: string[] = [S.PENDING_TARGET, S.PENDING_APPROVAL];

/** Lỗi DB thường gặp -> mã lỗi nghiệp vụ */
const mapError = (error: unknown, fallback = HR_ERROR.FAILED): number => {
    if (pgCode(error) === PG_EXCLUSION) return HR_ERROR.SHIFT_OVERLAP;
    return fallback;
};

const publicSettings = ({ qr_secret, ...rest }: IHrSettings & { qr_secret?: string }) => rest as IHrSettings;

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

export const getSettings = async (scope: HrScope, restaurantId?: number): Promise<IHrSettings | number> => {
    try {
        const r = await resolveRestaurant(scope, restaurantId);
        if (typeof r === "number") return r;
        return publicSettings(await hrRepository.getSettings(r.id));
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const updateSettings = async (body: IHrSettingsBody & { restaurant_id?: number }, scope: HrScope, audit: IAuditContext): Promise<IHrSettings | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const before = publicSettings(await hrRepository.getSettings(r.id));
            const { restaurant_id, ...changes } = body;
            const after = publicSettings(await hrRepository.updateSettings(r.id, changes));
            await writeAudit(audit, { action: "hr.settings_update", entity_type: "hr_settings", entity_id: r.id, restaurant_id: r.id, ...diffChanges(before, after) });
            return after;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Đổi khóa ký mã QR: mọi mã QR đang hiển thị / đã chụp lại hết hiệu lực */
export const rotateQrSecret = async (scope: HrScope, restaurantId: number | undefined, audit: IAuditContext): Promise<{ restaurant_id: number } | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, restaurantId);
            if (typeof r === "number") return rollback(r);
            await hrRepository.rotateQrSecret(r.id);
            await writeAudit(audit, { action: "attendance.qr_rotate", entity_type: "hr_settings", entity_id: r.id, restaurant_id: r.id });
            return { restaurant_id: r.id };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Nhân viên
// ---------------------------------------------------------------------------

export const getStaff = async (scope: HrScope, restaurantId?: number, includeInactive = false): Promise<IStaffMember[] | number> => {
    try {
        const r = await resolveRestaurant(scope, restaurantId);
        if (typeof r === "number") return r;
        return await hrRepository.getStaff(r.id, includeInactive);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Đồng nghiệp cùng chi nhánh (id, tên, vai trò) để chọn người nhận khi xin đổi ca */
export const getColleagues = async (userId: number, restaurantId: number | null): Promise<Pick<IStaffMember, "id" | "full_name" | "roles">[] | number> => {
    try {
        if (!restaurantId) return HR_ERROR.RESTAURANT_REQUIRED;
        return (await hrRepository.getStaff(restaurantId)).filter((s) => s.id !== userId).map(({ id, full_name, roles }) => ({ id, full_name, roles }));
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Ca mẫu
// ---------------------------------------------------------------------------

export const getTemplates = async (scope: HrScope, restaurantId?: number): Promise<IShiftTemplate[] | number> => {
    try {
        const r = await resolveRestaurant(scope, restaurantId);
        if (typeof r === "number") return r;
        return await hrRepository.getTemplates(r.id);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createTemplate = async (body: IShiftTemplateBody, scope: HrScope): Promise<IShiftTemplate | number> => {
    try {
        const r = await resolveRestaurant(scope, body.restaurant_id);
        if (typeof r === "number") return r;
        return await hrRepository.createTemplate({ ...body, restaurant_id: r.id });
    } catch (error) {
        return pgCode(error) === PG_UNIQUE ? HR_ERROR.TEMPLATE_DUPLICATE : HR_ERROR.FAILED;
    }
};

export const updateTemplate = async (id: number, body: IShiftTemplateBody, scope: HrScope): Promise<IShiftTemplate | number> => {
    try {
        const template = await hrRepository.getTemplateById(id);
        if (!template || !inScope(template.restaurant_id, scope)) return HR_ERROR.TEMPLATE_NOT_FOUND;
        if ((body.start_time ?? template.start_time) === (body.end_time ?? template.end_time)) return HR_ERROR.SHIFT_INVALID_TIME;
        return (await hrRepository.updateTemplate(id, body)) ?? HR_ERROR.TEMPLATE_NOT_FOUND;
    } catch (error) {
        return pgCode(error) === PG_UNIQUE ? HR_ERROR.TEMPLATE_DUPLICATE : HR_ERROR.FAILED;
    }
};

/** Xóa ca mẫu không ảnh hưởng các ca đã xếp (chỉ bỏ liên kết tên ca) */
export const deleteTemplate = async (id: number, scope: HrScope): Promise<{ id: number } | number> => {
    try {
        const template = await hrRepository.getTemplateById(id);
        if (!template || !inScope(template.restaurant_id, scope)) return HR_ERROR.TEMPLATE_NOT_FOUND;
        return (await hrRepository.deleteTemplate(id)) ?? HR_ERROR.TEMPLATE_NOT_FOUND;
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Lịch làm việc
// ---------------------------------------------------------------------------

export const getShifts = async (
    scope: HrScope,
    query: { restaurant_id?: number; from: string; to: string; user_id?: number },
): Promise<IShiftAssignment[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        return await hrRepository.getShifts({ restaurantId: r.id, from: query.from, to: query.to, userId: query.user_id });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getMyShifts = async (userId: number, from: string, to: string): Promise<IShiftAssignment[] | number> => {
    try {
        return await hrRepository.getShifts({ restaurantId: null, from, to, userId });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Ca sắp tới (chưa bắt đầu, chưa chấm công) của một đồng nghiệp cùng chi nhánh: để chọn ca muốn đổi lại */
export const getColleagueShifts = async (
    restaurantId: number | null,
    query: { user_id: number; from: string; to: string },
): Promise<IShiftAssignment[] | number> => {
    try {
        if (!restaurantId) return HR_ERROR.RESTAURANT_REQUIRED;
        const colleague = await hrRepository.getStaffMember(query.user_id);
        if (!colleague || colleague.restaurant_id !== restaurantId || colleague.status !== "active") return HR_ERROR.STAFF_NOT_FOUND;
        const shifts = await hrRepository.getShifts({ restaurantId, from: query.from, to: query.to, userId: query.user_id });
        const now = new Date();
        return shifts.filter((s) => new Date(s.start_at) > now && !s.attendance_id && !s.on_leave);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Giờ ca từ ca mẫu (cùng chi nhánh, đang dùng) hoặc giờ nhập tay */
const resolveTimes = async (
    restaurantId: number,
    body: { shift_template_id?: number | null; start_time?: string; end_time?: string; break_minutes?: number },
): Promise<{ template_id: number | null; start: string; end: string; break_minutes: number } | number> => {
    if (body.shift_template_id) {
        const t = await hrRepository.getTemplateById(body.shift_template_id);
        if (!t || t.restaurant_id !== restaurantId || t.status !== "active") return HR_ERROR.TEMPLATE_NOT_FOUND;
        return {
            template_id: t.id,
            start: body.start_time ?? t.start_time,
            end: body.end_time ?? t.end_time,
            break_minutes: body.break_minutes ?? t.break_minutes,
        };
    }
    if (!body.start_time || !body.end_time || body.start_time === body.end_time) return HR_ERROR.SHIFT_INVALID_TIME;
    return { template_id: null, start: body.start_time, end: body.end_time, break_minutes: body.break_minutes ?? 0 };
};

/** Xếp ca hàng loạt: mỗi nhân viên × mỗi ngày một ca. Trùng giờ với ca khác thì hủy cả lô. */
export const createShifts = async (body: ICreateShiftsBody, scope: HrScope, actor: IHrActor): Promise<IShiftAssignment[] | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const times = await resolveTimes(r.id, body);
            if (typeof times === "number") return rollback(times);
            for (const userId of body.user_ids) {
                const target = await checkTarget(userId, r.id, actor, { allowSelf: true });
                if (typeof target === "number") return rollback(target);
                if (target.status !== "active") return rollback(HR_ERROR.STAFF_NOT_FOUND);
            }
            const ids: number[] = [];
            for (const date of body.dates) {
                const window = shiftWindow(date, times.start, times.end);
                if (window.end_at.getTime() - window.start_at.getTime() <= times.break_minutes * 60000) return rollback(HR_ERROR.SHIFT_INVALID_TIME);
                for (const userId of body.user_ids) {
                    if (await hrRepository.countOverlappingShifts(userId, window.start_at, window.end_at)) return rollback(HR_ERROR.SHIFT_OVERLAP);
                    const created = await hrRepository.createShift({
                        restaurant_id: r.id,
                        user_id: userId,
                        shift_template_id: times.template_id,
                        work_date: date,
                        ...window,
                        break_minutes: times.break_minutes,
                        note: body.note ?? null,
                        created_by: actor.userId,
                    });
                    ids.push(created.id);
                }
            }
            const shifts = await hrRepository.getShifts({ restaurantId: r.id, from: [...body.dates].sort()[0], to: [...body.dates].sort().at(-1)! });
            return shifts.filter((s) => ids.includes(s.id));
        });
    } catch (error) {
        return mapError(error);
    }
};

/** Sửa ca (đổi giờ / ngày / người). Ca đã chấm công thì không sửa được. */
export const updateShift = async (id: number, body: IUpdateShiftBody, scope: HrScope, actor: IHrActor): Promise<IShiftAssignment | number> => {
    try {
        return await withTransaction(async () => {
            const shift = await hrRepository.getShiftById(id, true);
            if (!shift || !inScope(shift.restaurant_id, scope)) return rollback(HR_ERROR.SHIFT_NOT_FOUND);
            if (shift.attendance_id) return rollback(HR_ERROR.SHIFT_HAS_ATTENDANCE);
            const current = await checkTarget(shift.user_id, shift.restaurant_id, actor, { allowSelf: true });
            if (typeof current === "number") return rollback(current);
            const userId = body.user_id ?? shift.user_id;
            if (userId !== shift.user_id) {
                const target = await checkTarget(userId, shift.restaurant_id, actor, { allowSelf: true });
                if (typeof target === "number") return rollback(target);
                if (target.status !== "active") return rollback(HR_ERROR.STAFF_NOT_FOUND);
            }
            const changesTime = body.work_date || body.start_time || body.end_time || body.shift_template_id !== undefined || body.break_minutes !== undefined;
            const payload: Record<string, unknown> = { user_id: userId, note: body.note };
            if (changesTime) {
                const date = body.work_date ?? shift.work_date;
                // Chọn ca mẫu mới: lấy giờ của ca mẫu (giờ nhập kèm theo được ưu tiên); không thì giữ giờ cũ, sửa phần được gửi
                const times = body.shift_template_id
                    ? await resolveTimes(shift.restaurant_id, body)
                    : await resolveTimes(shift.restaurant_id, {
                          start_time: body.start_time ?? hhmm(shift.start_at),
                          end_time: body.end_time ?? hhmm(shift.end_at),
                          break_minutes: body.break_minutes ?? shift.break_minutes,
                      });
                if (typeof times === "number") return rollback(times);
                const window = shiftWindow(date, times.start, times.end);
                const keepTemplate = !body.shift_template_id && body.shift_template_id !== null && !body.start_time && !body.end_time;
                Object.assign(payload, {
                    work_date: date,
                    ...window,
                    break_minutes: times.break_minutes,
                    shift_template_id: keepTemplate ? shift.shift_template_id : times.template_id,
                });
                if (window.end_at.getTime() - window.start_at.getTime() <= times.break_minutes * 60000) return rollback(HR_ERROR.SHIFT_INVALID_TIME);
            }
            const start = (payload.start_at as Date | undefined) ?? new Date(shift.start_at);
            const end = (payload.end_at as Date | undefined) ?? new Date(shift.end_at);
            if (await hrRepository.countOverlappingShifts(userId, start, end, [id])) return rollback(HR_ERROR.SHIFT_OVERLAP);
            await hrRepository.updateShift(id, payload);
            // Đổi người / giờ: các yêu cầu đổi ca đang mở của ca này không còn đúng
            await hrRepository.cancelOpenSwaps(id);
            return (await hrRepository.getShiftById(id))!;
        });
    } catch (error) {
        return mapError(error);
    }
};

/** "HH:MM" giờ Việt Nam của một mốc thời gian */
const hhmm = (at: Date | string): string => new Date(new Date(at).getTime() + 7 * 3600_000).toISOString().slice(11, 16);

export const deleteShift = async (id: number, scope: HrScope, actor: IHrActor): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            const shift = await hrRepository.getShiftById(id, true);
            if (!shift || !inScope(shift.restaurant_id, scope)) return rollback(HR_ERROR.SHIFT_NOT_FOUND);
            if (shift.attendance_id) return rollback(HR_ERROR.SHIFT_HAS_ATTENDANCE);
            const target = await checkTarget(shift.user_id, shift.restaurant_id, actor, { allowSelf: true });
            if (typeof target === "number") return rollback(target);
            await hrRepository.cancelOpenSwaps(id);
            await hrRepository.deleteShift(id);
            return { id };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/**
 * Sao chép lịch một tuần sang tuần khác (cùng thứ trong tuần). Bỏ qua ca trùng giờ với ca đã có, ca của người đã nghỉ việc /
 * chuyển chi nhánh, và ca của người mình không quản lý được.
 */
export const copyWeek = async (
    body: { restaurant_id?: number; from_week: string; to_week: string },
    scope: HrScope,
    actor: IHrActor,
): Promise<{ created: number; skipped: number } | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const offset = daysBetween(body.from_week, body.to_week);
            const source = await hrRepository.getShifts({ restaurantId: r.id, from: body.from_week, to: addDays(body.from_week, 6) });
            let created = 0;
            let skipped = 0;
            const allowed = new Map<number, boolean>();
            for (const s of source) {
                if (!allowed.has(s.user_id)) {
                    const t = await checkTarget(s.user_id, r.id, actor, { allowSelf: true });
                    allowed.set(s.user_id, typeof t !== "number" && t.status === "active");
                }
                const start = new Date(new Date(s.start_at).getTime() + offset * 86_400_000);
                const end = new Date(new Date(s.end_at).getTime() + offset * 86_400_000);
                if (!allowed.get(s.user_id) || (await hrRepository.countOverlappingShifts(s.user_id, start, end))) {
                    skipped++;
                    continue;
                }
                await hrRepository.createShift({
                    restaurant_id: r.id,
                    user_id: s.user_id,
                    shift_template_id: s.shift_template_id,
                    work_date: addDays(s.work_date, offset),
                    start_at: start,
                    end_at: end,
                    break_minutes: s.break_minutes,
                    note: s.note,
                    created_by: actor.userId,
                });
                created++;
            }
            return { created, skipped };
        });
    } catch (error) {
        return mapError(error);
    }
};

// ---------------------------------------------------------------------------
// Đổi ca: người xin -> người nhận đồng ý -> quản lý duyệt
// ---------------------------------------------------------------------------

/** Ca còn đổi được: của đúng người, chưa bắt đầu, chưa chấm công */
const swappable = (shift: IShiftAssignment | undefined, userId: number): shift is IShiftAssignment =>
    !!shift && shift.user_id === userId && new Date(shift.start_at) > new Date() && !shift.attendance_id;

export const getMySwaps = async (userId: number): Promise<IShiftSwap[] | number> => {
    try {
        return await hrRepository.getSwaps({ restaurantId: null, userId });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createSwap = async (
    requester: { id: number; restaurant_id: number | null },
    body: { assignment_id: number; target_user_id: number; target_assignment_id?: number | null; reason?: string | null },
): Promise<IShiftSwap | number> => {
    try {
        return await withTransaction(async () => {
            const shift = await hrRepository.getShiftById(body.assignment_id, true);
            if (!swappable(shift, requester.id)) return rollback(HR_ERROR.SWAP_INVALID_SHIFT);
            if (await hrRepository.countOpenSwaps(shift.id)) return rollback(HR_ERROR.INVALID_STATUS);
            const target = await hrRepository.getStaffMember(body.target_user_id);
            if (!target || target.id === requester.id || target.restaurant_id !== shift.restaurant_id || target.status !== "active") {
                return rollback(HR_ERROR.STAFF_NOT_FOUND);
            }
            if (body.target_assignment_id) {
                const targetShift = await hrRepository.getShiftById(body.target_assignment_id, true);
                if (!swappable(targetShift, target.id)) return rollback(HR_ERROR.SWAP_INVALID_SHIFT);
                if (await hrRepository.countOpenSwaps(targetShift.id)) return rollback(HR_ERROR.INVALID_STATUS);
            }
            const { id } = await hrRepository.createSwap({
                restaurant_id: shift.restaurant_id,
                assignment_id: shift.id,
                requester_id: requester.id,
                target_user_id: target.id,
                target_assignment_id: body.target_assignment_id ?? null,
                reason: body.reason ?? null,
                status: S.PENDING_TARGET,
            });
            return (await hrRepository.getSwapById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Người nhận đồng ý / từ chối; người xin hủy */
export const respondSwap = async (id: number, userId: number, action: "accept" | "decline" | "cancel"): Promise<IShiftSwap | number> => {
    try {
        return await withTransaction(async () => {
            const swap = await hrRepository.getSwapById(id, true);
            if (!swap || (action === "cancel" ? swap.requester_id : swap.target_user_id) !== userId) return rollback(HR_ERROR.SWAP_NOT_FOUND);
            if (action === "cancel") {
                if (!OPEN_SWAP.includes(swap.status)) return rollback(HR_ERROR.INVALID_STATUS);
                await hrRepository.updateSwap(id, { status: S.CANCELLED });
            } else {
                if (swap.status !== S.PENDING_TARGET) return rollback(HR_ERROR.INVALID_STATUS);
                await hrRepository.updateSwap(id, {
                    status: action === "accept" ? S.PENDING_APPROVAL : S.DECLINED,
                    target_responded_at: new Date(),
                });
            }
            return (await hrRepository.getSwapById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getSwaps = async (scope: HrScope, query: { restaurant_id?: number; status?: string }): Promise<IShiftSwap[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        return await hrRepository.getSwaps({ restaurantId: r.id, status: query.status });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Quản lý duyệt: nhường ca thì ca chuyển sang người nhận; đổi ca thì hai người hoán đổi ca cho nhau */
export const decideSwap = async (
    id: number,
    approve: boolean,
    note: string | null | undefined,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<IShiftSwap | number> => {
    try {
        return await withTransaction(async () => {
            const swap = await hrRepository.getSwapById(id, true);
            if (!swap || !inScope(swap.restaurant_id, scope)) return rollback(HR_ERROR.SWAP_NOT_FOUND);
            if (swap.status !== S.PENDING_APPROVAL) return rollback(HR_ERROR.INVALID_STATUS);
            for (const userId of [swap.requester_id, swap.target_user_id]) {
                const t = await checkTarget(userId, null, actor);
                if (typeof t === "number") return rollback(t === HR_ERROR.STAFF_NOT_FOUND ? HR_ERROR.SWAP_INVALID_SHIFT : t);
            }
            if (approve) {
                const shift = await hrRepository.getShiftById(swap.assignment_id, true);
                const targetShift = swap.target_assignment_id ? await hrRepository.getShiftById(swap.target_assignment_id, true) : null;
                if (!swappable(shift, swap.requester_id) || (swap.target_assignment_id && !swappable(targetShift ?? undefined, swap.target_user_id))) {
                    return rollback(HR_ERROR.SWAP_INVALID_SHIFT);
                }
                const exclude = [shift.id, ...(targetShift ? [targetShift.id] : [])];
                if (await hrRepository.countOverlappingShifts(swap.target_user_id, new Date(shift.start_at), new Date(shift.end_at), exclude)) {
                    return rollback(HR_ERROR.SHIFT_OVERLAP);
                }
                if (targetShift && (await hrRepository.countOverlappingShifts(swap.requester_id, new Date(targetShift.start_at), new Date(targetShift.end_at), exclude))) {
                    return rollback(HR_ERROR.SHIFT_OVERLAP);
                }
                await hrRepository.deferShiftOverlapCheck();
                await hrRepository.updateShift(shift.id, { user_id: swap.target_user_id });
                if (targetShift) await hrRepository.updateShift(targetShift.id, { user_id: swap.requester_id });
            }
            await hrRepository.updateSwap(id, {
                status: approve ? S.APPROVED : S.REJECTED,
                decided_by: actor.userId,
                decided_at: new Date(),
                decision_note: note ?? null,
            });
            if (approve) {
                // Các yêu cầu khác của hai ca không còn đúng
                await hrRepository.cancelOpenSwaps(swap.assignment_id);
                if (swap.target_assignment_id) await hrRepository.cancelOpenSwaps(swap.target_assignment_id);
            }
            const result = (await hrRepository.getSwapById(id))!;
            await writeAudit(audit, {
                action: approve ? "shift.swap_approve" : "shift.swap_reject",
                entity_type: "shift_swap",
                entity_id: id,
                restaurant_id: swap.restaurant_id,
                after: {
                    requester_id: swap.requester_id,
                    target_user_id: swap.target_user_id,
                    assignment_id: swap.assignment_id,
                    target_assignment_id: swap.target_assignment_id,
                    note: note ?? null,
                },
            });
            return result;
        });
    } catch (error) {
        return mapError(error);
    }
};

// ---------------------------------------------------------------------------
// Nghỉ phép
// ---------------------------------------------------------------------------

export const getMyLeaves = async (userId: number): Promise<ILeaveRequest[] | number> => {
    try {
        return await hrRepository.getLeaves({ restaurantId: null, userId });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createLeave = async (
    user: { id: number; restaurant_id: number | null },
    body: { start_date: string; end_date: string; type: string; reason?: string | null },
): Promise<ILeaveRequest | number> => {
    try {
        if (!user.restaurant_id) return HR_ERROR.RESTAURANT_REQUIRED;
        return await withTransaction(async () => {
            if (await hrRepository.countOverlappingLeaves(user.id, body.start_date, body.end_date)) return rollback(HR_ERROR.LEAVE_OVERLAP);
            const { id } = await hrRepository.createLeave({
                restaurant_id: user.restaurant_id!,
                user_id: user.id,
                start_date: body.start_date,
                end_date: body.end_date,
                type: body.type as ILeaveRequest["type"],
                reason: body.reason ?? null,
            });
            return (await hrRepository.getLeaveById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const cancelLeave = async (id: number, userId: number): Promise<ILeaveRequest | number> => {
    try {
        return await withTransaction(async () => {
            const leave = await hrRepository.getLeaveById(id, true);
            if (!leave || leave.user_id !== userId) return rollback(HR_ERROR.LEAVE_NOT_FOUND);
            if (leave.status !== LeaveStatusEnum.PENDING) return rollback(HR_ERROR.INVALID_STATUS);
            await hrRepository.updateLeave(id, { status: LeaveStatusEnum.CANCELLED });
            return (await hrRepository.getLeaveById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getLeaves = async (
    scope: HrScope,
    query: { restaurant_id?: number; status?: string; user_id?: number; from?: string; to?: string },
): Promise<ILeaveRequest[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        return await hrRepository.getLeaves({ restaurantId: r.id, status: query.status, userId: query.user_id, from: query.from, to: query.to });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Duyệt nghỉ: các ca chưa chấm công trong những ngày nghỉ bị gỡ khỏi lịch (để xếp người khác) */
export const decideLeave = async (
    id: number,
    approve: boolean,
    note: string | null | undefined,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<ILeaveRequest | number> => {
    try {
        return await withTransaction(async () => {
            const leave = await hrRepository.getLeaveById(id, true);
            if (!leave || !inScope(leave.restaurant_id, scope)) return rollback(HR_ERROR.LEAVE_NOT_FOUND);
            if (leave.status !== LeaveStatusEnum.PENDING) return rollback(HR_ERROR.INVALID_STATUS);
            const target = await checkTarget(leave.user_id, null, actor);
            if (typeof target === "number") return rollback(target);
            let removedShifts: number[] = [];
            if (approve) {
                for (const month of new Set(eachDay(leave.start_date, leave.end_date).map((d) => d.slice(0, 7)))) {
                    if (await isPayrollLocked(leave.restaurant_id, `${month}-01`)) return rollback(HR_ERROR.PAYROLL_LOCKED);
                }
                removedShifts = await hrRepository.deleteShiftsInRange(leave.user_id, leave.start_date, leave.end_date);
                for (const shiftId of removedShifts) await hrRepository.cancelOpenSwaps(shiftId);
            }
            await hrRepository.updateLeave(id, {
                status: approve ? LeaveStatusEnum.APPROVED : LeaveStatusEnum.REJECTED,
                decided_by: actor.userId,
                decided_at: new Date(),
                decision_note: note ?? null,
            });
            await writeAudit(audit, {
                action: approve ? "leave.approve" : "leave.reject",
                entity_type: "leave_request",
                entity_id: id,
                restaurant_id: leave.restaurant_id,
                after: { user_id: leave.user_id, start_date: leave.start_date, end_date: leave.end_date, type: leave.type, removed_shifts: removedShifts, note: note ?? null },
            });
            return (await hrRepository.getLeaveById(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Đánh giá và hiệu suất
// ---------------------------------------------------------------------------

export const upsertReview = async (
    body: { user_id: number; month: string; rating: number; comment?: string | null; restaurant_id?: number },
    scope: HrScope,
    actor: IHrActor,
): Promise<IStaffReview | number> => {
    try {
        const r = await resolveRestaurant(scope, body.restaurant_id);
        if (typeof r === "number") return r;
        const target = await checkTarget(body.user_id, r.id, actor);
        if (typeof target === "number") return target;
        return await hrRepository.upsertReview({
            restaurant_id: r.id,
            user_id: body.user_id,
            period_month: monthRange(body.month).start,
            rating: body.rating,
            comment: body.comment ?? null,
            reviewer_id: actor.userId,
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/**
 * Hiệu suất theo tháng: chấm công (ngày công, giờ làm, đi muộn, vắng ca), nghỉ phép, số order phụ trách đã hoàn tất,
 * tip, thưởng / phạt, đánh giá. Gồm nhân viên đang làm và người có số liệu trong tháng.
 */
export const getPerformance = async (scope: HrScope, query: { restaurant_id?: number; month: string }): Promise<IStaffPerformance[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        const { start, end } = monthRange(query.month);
        const [staff, stats, reviews] = await Promise.all([
            hrRepository.getStaff(r.id),
            hrRepository.getPerformanceStats(r.id, start, end),
            hrRepository.getReviews(r.id, start),
        ]);
        const statMap = new Map(stats.map((s) => [s.user_id, s]));
        const reviewMap = new Map(reviews.map((rv) => [rv.user_id, rv]));
        const extra = await hrRepository.getStaffMembers(stats.map((s) => s.user_id).filter((id) => !staff.some((m) => m.id === id)));
        return [...staff, ...extra].map((m) => {
            const s = statMap.get(m.id);
            return {
                user_id: m.id,
                full_name: m.full_name,
                roles: m.roles,
                scheduled_shifts: s?.scheduled_shifts ?? 0,
                work_days: s?.work_days ?? 0,
                worked_minutes: s?.worked_minutes ?? 0,
                overtime_minutes: s?.overtime_minutes ?? 0,
                late_count: s?.late_count ?? 0,
                late_minutes: s?.late_minutes ?? 0,
                early_leave_count: s?.early_leave_count ?? 0,
                absent_shifts: s?.absent_shifts ?? 0,
                leave_days: s?.leave_days ?? 0,
                orders_served: s?.orders_served ?? 0,
                tip_total: s?.tip_total ?? "0",
                bonus_total: s?.bonus_total ?? "0",
                penalty_total: s?.penalty_total ?? "0",
                review: reviewMap.get(m.id) ?? null,
            };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};
