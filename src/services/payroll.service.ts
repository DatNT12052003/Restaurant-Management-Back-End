import { AdjustmentTypeEnum, OvertimeStatusEnum, PayrollStatusEnum, PayTypeEnum } from "~/common/enum";
import { HR_ERROR } from "~/common/error-code/hr";
import { rollback, withTransaction } from "~/config/db";
import {
    HrScope,
    IAdjustment,
    IAdjustmentBody,
    IAllowance,
    IAllowanceBody,
    IAuditContext,
    ICompensation,
    ICompensationBody,
    IHrActor,
    IPayroll,
    IPayrollItem,
    IPayrollItemDetails,
} from "~/interfaces";
import { hrRepository } from "~/repositories";
import { diffChanges, writeAudit } from "~/utils/audit";
import { eachDay, monthRange, todayVn } from "~/utils/hr-time";
import { checkTarget, inScope, isPayrollLocked, pgCode, PG_UNIQUE, resolveRestaurant } from "./hr-access";

/**
 * Giai đoạn 12: lương (câu hỏi 10 đã chốt).
 * - Lương theo tháng: lương tháng / số ngày công chuẩn × (ngày có chấm công + ngày nghỉ có lương).
 * - Lương theo giờ: đơn giá × số giờ làm trong ca (+ ngày nghỉ có lương × số giờ chuẩn / ngày).
 * - Tăng ca đã duyệt: số giờ × đơn giá giờ (lương tháng quy ra: lương / ngày công chuẩn / giờ chuẩn) × hệ số.
 * - Phụ cấp cố định theo tháng (cộng đủ nếu trong tháng có ngày công hoặc nghỉ có lương), thưởng / phạt từng lần, tip.
 * Mỗi ngày dùng mức lương có hiệu lực ngày đó. Tiền làm tròn tới đồng.
 */

const money = (n: number) => Math.round(n);

// ---------------------------------------------------------------------------
// Lịch sử lương
// ---------------------------------------------------------------------------

/** Người xem lương của người khác phải có cấp cao hơn; được xem của chính mình */
export const getCompensations = async (userId: number, scope: HrScope, actor: IHrActor): Promise<ICompensation[] | number> => {
    try {
        const target = await checkTarget(userId, scope ?? null, actor, { allowSelf: true });
        if (typeof target === "number") return target;
        return await hrRepository.getCompensations(userId);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createCompensation = async (
    userId: number,
    body: ICompensationBody,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<ICompensation | number> => {
    try {
        return await withTransaction(async () => {
            const target = await checkTarget(userId, scope ?? null, actor);
            if (typeof target === "number") return rollback(target);
            const created = await hrRepository.createCompensation({ user_id: userId, ...body, note: body.note ?? null, created_by: actor.userId });
            await hrRepository.syncCurrentSalary(userId);
            await writeAudit(audit, {
                action: "payroll.compensation_create",
                entity_type: "user",
                entity_id: userId,
                restaurant_id: target.restaurant_id,
                after: { pay_type: created.pay_type, amount: created.amount, effective_from: created.effective_from, note: created.note },
            });
            return created;
        });
    } catch (error) {
        return pgCode(error) === PG_UNIQUE ? HR_ERROR.COMPENSATION_DUPLICATE : HR_ERROR.FAILED;
    }
};

/**
 * Mức lương nhập ở form nhân viên (cột `users.salary`): ghi thành một mức mới áp dụng từ hôm nay,
 * giữ kiểu lương hiện hành (mặc định theo tháng). Gọi trong transaction cập nhật nhân viên.
 */
export const recordSalaryFromProfile = async (userId: number, salary: number | null, actorId: number | null): Promise<void> => {
    if (salary === null || salary === undefined) return;
    const history = await hrRepository.getCompensations(userId);
    const today = todayVn();
    const current = history.find((c) => c.effective_from <= today);
    if (current && Number(current.amount) === Number(salary)) return;
    const payType = current?.pay_type ?? PayTypeEnum.MONTHLY;
    const sameDay = history.find((c) => c.effective_from === today);
    // Đã có mức áp dụng từ hôm nay: thay số tiền của mức đó
    if (sameDay) return hrRepository.updateCompensationAmount(sameDay.id, salary);
    await hrRepository.createCompensation({ user_id: userId, pay_type: payType, amount: salary, effective_from: today, note: "Cập nhật từ hồ sơ nhân viên", created_by: actorId });
};

// ---------------------------------------------------------------------------
// Phụ cấp cố định
// ---------------------------------------------------------------------------

export const getAllowances = async (userId: number, scope: HrScope, actor: IHrActor): Promise<IAllowance[] | number> => {
    try {
        const target = await checkTarget(userId, scope ?? null, actor, { allowSelf: true });
        if (typeof target === "number") return target;
        return await hrRepository.getAllowances(userId);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createAllowance = async (
    userId: number,
    body: Required<Pick<IAllowanceBody, "name" | "amount">> & IAllowanceBody,
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<IAllowance | number> => {
    try {
        return await withTransaction(async () => {
            const target = await checkTarget(userId, scope ?? null, actor);
            if (typeof target === "number") return rollback(target);
            const created = await hrRepository.createAllowance({ user_id: userId, ...body, created_by: actor.userId });
            await writeAudit(audit, { action: "payroll.allowance_create", entity_type: "allowance", entity_id: created.id, restaurant_id: target.restaurant_id, after: created });
            return created;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const updateAllowance = async (id: number, body: IAllowanceBody, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<IAllowance | number> => {
    try {
        return await withTransaction(async () => {
            const before = await hrRepository.getAllowanceById(id);
            if (!before) return rollback(HR_ERROR.ALLOWANCE_NOT_FOUND);
            const target = await checkTarget(before.user_id, scope ?? null, actor);
            if (typeof target === "number") return rollback(target === HR_ERROR.STAFF_NOT_FOUND ? HR_ERROR.ALLOWANCE_NOT_FOUND : target);
            const after = (await hrRepository.updateAllowance(id, body))!;
            await writeAudit(audit, { action: "payroll.allowance_update", entity_type: "allowance", entity_id: id, restaurant_id: target.restaurant_id, ...diffChanges(before, after) });
            return after;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const deleteAllowance = async (id: number, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            const before = await hrRepository.getAllowanceById(id);
            if (!before) return rollback(HR_ERROR.ALLOWANCE_NOT_FOUND);
            const target = await checkTarget(before.user_id, scope ?? null, actor);
            if (typeof target === "number") return rollback(target === HR_ERROR.STAFF_NOT_FOUND ? HR_ERROR.ALLOWANCE_NOT_FOUND : target);
            await hrRepository.deleteAllowance(id);
            await writeAudit(audit, { action: "payroll.allowance_delete", entity_type: "allowance", entity_id: id, restaurant_id: target.restaurant_id, before });
            return { id };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Thưởng / phạt
// ---------------------------------------------------------------------------

export const getAdjustments = async (scope: HrScope, query: { restaurant_id?: number; month: string; user_id?: number }): Promise<IAdjustment[] | number> => {
    try {
        const r = await resolveRestaurant(scope, query.restaurant_id);
        if (typeof r === "number") return r;
        const { start, end } = monthRange(query.month);
        return await hrRepository.getAdjustments({ restaurantId: r.id, from: start, to: end, userId: query.user_id });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const createAdjustment = async (body: IAdjustmentBody, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<IAdjustment | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const target = await checkTarget(body.user_id, r.id, actor);
            if (typeof target === "number") return rollback(target);
            if (await isPayrollLocked(r.id, body.effective_date)) return rollback(HR_ERROR.PAYROLL_LOCKED);
            const { id } = await hrRepository.createAdjustment({
                restaurant_id: r.id,
                user_id: body.user_id,
                type: body.type,
                amount: body.amount,
                reason: body.reason,
                effective_date: body.effective_date,
                source: "manual",
                created_by: actor.userId,
            });
            const created = (await hrRepository.getAdjustmentById(id))!;
            await writeAudit(audit, { action: `payroll.${body.type}_create`, entity_type: "adjustment", entity_id: id, restaurant_id: r.id, after: created });
            return created;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const deleteAdjustment = async (id: number, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            const adj = await hrRepository.getAdjustmentById(id);
            if (!adj || !inScope(adj.restaurant_id, scope)) return rollback(HR_ERROR.ADJUSTMENT_NOT_FOUND);
            const target = await checkTarget(adj.user_id, null, actor);
            if (typeof target === "number") return rollback(target);
            if (adj.payroll_id || (await isPayrollLocked(adj.restaurant_id, adj.effective_date))) return rollback(HR_ERROR.PAYROLL_LOCKED);
            await hrRepository.deleteAdjustment(id);
            await writeAudit(audit, { action: `payroll.${adj.type}_delete`, entity_type: "adjustment", entity_id: id, restaurant_id: adj.restaurant_id, before: adj });
            return { id };
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Tính bảng lương
// ---------------------------------------------------------------------------

type ComputedItem = Omit<IPayrollItem, "id" | "payroll_id">;

/** Tính lương tháng của mọi nhân viên của chi nhánh (đang làm, hoặc có số liệu ở chi nhánh trong tháng) */
export const computeItems = async (restaurantId: number, month: string): Promise<{ items: ComputedItem[]; adjustmentIds: number[] }> => {
    const { start, end } = monthRange(month);
    const settings = await hrRepository.getSettings(restaurantId);
    const stdDays = settings.standard_work_days;
    const hoursPerDay = Number(settings.standard_hours_per_day);
    const multiplier = Number(settings.overtime_multiplier);

    const active = await hrRepository.getStaff(restaurantId);
    const activity = await hrRepository.getUsersWithActivity(restaurantId, start, end);
    const userIds = [...new Set([...active.map((s) => s.id), ...activity])];
    const members = await hrRepository.getStaffMembers(userIds);
    const ids = members.map((m) => m.id);

    const [attendance, leaves, comps, allowances, adjustments, tips] = await Promise.all([
        hrRepository.getClosedAttendance(restaurantId, start, end),
        hrRepository.getApprovedLeaves(restaurantId, start, end),
        hrRepository.getCompensationsUpTo(ids, end),
        hrRepository.getActiveAllowances(ids),
        hrRepository.getAdjustments({ restaurantId, from: start, to: end }),
        hrRepository.getTipsByStaff(restaurantId, start, end),
    ]);

    const items: ComputedItem[] = [];
    for (const m of members.sort((a, b) => a.full_name.localeCompare(b.full_name, "vi") || a.id - b.id)) {
        const history = comps.filter((c) => c.user_id === m.id);
        const rateOn = (date: string) => [...history].reverse().find((c) => c.effective_from <= date);
        const records = attendance.filter((a) => a.user_id === m.id);
        const workDates = new Set(records.map((a) => a.work_date));
        const paidLeave = new Set<string>();
        const unpaidLeave = new Set<string>();
        for (const l of leaves.filter((x) => x.user_id === m.id)) {
            for (const d of eachDay(l.start_date < start ? start : l.start_date, l.end_date > end ? end : l.end_date)) {
                if (workDates.has(d)) continue;
                (l.type === "paid" ? paidLeave : unpaidLeave).add(d);
            }
        }

        const rates = new Map<string, IPayrollItemDetails["rates"][number]>();
        const rateEntry = (pay_type: PayTypeEnum, amount: number) => {
            const key = `${pay_type}|${amount}`;
            if (!rates.has(key)) rates.set(key, { pay_type, amount, days: 0, minutes: 0, base_pay: 0 });
            return rates.get(key)!;
        };
        let missingRateDays = 0;
        let basePay = 0;
        let overtimePay = 0;
        let overtimeMinutes = 0;
        let pendingOvertime = 0;
        let workedMinutes = 0;

        // Lương theo ngày (lương tháng) và ngày nghỉ có lương
        for (const d of [...workDates, ...paidLeave]) {
            const rate = rateOn(d);
            if (!rate) {
                missingRateDays++;
                continue;
            }
            const amount = Number(rate.amount);
            const entry = rateEntry(rate.pay_type, amount);
            entry.days++;
            if (rate.pay_type === PayTypeEnum.MONTHLY) {
                const pay = amount / stdDays;
                entry.base_pay += pay;
                basePay += pay;
            } else if (paidLeave.has(d)) {
                const pay = amount * hoursPerDay;
                entry.minutes += hoursPerDay * 60;
                entry.base_pay += pay;
                basePay += pay;
            }
        }
        // Lương theo giờ và tăng ca theo từng lượt chấm công
        for (const a of records) {
            workedMinutes += a.worked_minutes;
            const regular = Math.max(0, a.worked_minutes - a.overtime_minutes);
            const rate = rateOn(a.work_date);
            if (a.overtime_status === OvertimeStatusEnum.PENDING) pendingOvertime += a.overtime_minutes;
            if (!rate) continue;
            const amount = Number(rate.amount);
            if (rate.pay_type === PayTypeEnum.HOURLY) {
                const pay = (regular / 60) * amount;
                const entry = rateEntry(rate.pay_type, amount);
                entry.minutes += regular;
                entry.base_pay += pay;
                basePay += pay;
            }
            if (a.overtime_status === OvertimeStatusEnum.APPROVED && a.overtime_minutes > 0) {
                const hourly = rate.pay_type === PayTypeEnum.HOURLY ? amount : amount / stdDays / hoursPerDay;
                overtimePay += (a.overtime_minutes / 60) * hourly * multiplier;
                overtimeMinutes += a.overtime_minutes;
            }
        }

        const paidDays = workDates.size + paidLeave.size;
        const myAllowances = paidDays > 0 ? allowances.filter((x) => x.user_id === m.id) : [];
        const myAdjustments = adjustments.filter((x) => x.user_id === m.id);
        const allowanceTotal = myAllowances.reduce((s, x) => s + Number(x.amount), 0);
        const bonusTotal = myAdjustments.filter((x) => x.type === AdjustmentTypeEnum.BONUS).reduce((s, x) => s + Number(x.amount), 0);
        const penaltyTotal = myAdjustments.filter((x) => x.type === AdjustmentTypeEnum.PENALTY).reduce((s, x) => s + Number(x.amount), 0);
        const tipTotal = tips.get(m.id) ?? 0;
        const last = rateOn(end);

        const item: ComputedItem = {
            user_id: m.id,
            full_name: m.full_name,
            pay_type: last?.pay_type ?? null,
            rate: last ? Number(last.amount) : null,
            work_days: workDates.size,
            paid_leave_days: paidLeave.size,
            unpaid_leave_days: unpaidLeave.size,
            worked_minutes: workedMinutes,
            overtime_minutes: overtimeMinutes,
            late_count: records.filter((a) => a.late_minutes > 0).length,
            base_pay: money(basePay),
            overtime_pay: money(overtimePay),
            allowance_total: money(allowanceTotal),
            bonus_total: money(bonusTotal),
            penalty_total: money(penaltyTotal),
            tip_total: money(tipTotal),
            net_pay: 0,
            details: {
                rates: [...rates.values()].map((r) => ({ ...r, base_pay: money(r.base_pay) })),
                allowances: myAllowances.map((x) => ({ name: x.name, amount: Number(x.amount) })),
                adjustments: myAdjustments.map((x) => ({ id: x.id, type: x.type, amount: Number(x.amount), reason: x.reason, effective_date: x.effective_date })),
                missing_rate_days: missingRateDays,
                pending_overtime_minutes: pendingOvertime,
            },
        };
        item.net_pay = money(
            Number(item.base_pay) + Number(item.overtime_pay) + Number(item.allowance_total) + Number(item.bonus_total) + Number(item.tip_total) - Number(item.penalty_total),
        );
        items.push(item);
    }
    return { items, adjustmentIds: adjustments.map((a) => a.id) };
};

const totals = (items: ComputedItem[]) => ({
    total_net: items.reduce((s, i) => s + Number(i.net_pay), 0),
    // Chi phí nhân công không gồm tip (khách trả cho nhân viên)
    labor_cost: items.reduce((s, i) => s + Number(i.net_pay) - Number(i.tip_total), 0),
    employee_count: items.length,
});

const detail = async (id: number): Promise<IPayroll | undefined> => {
    const payroll = await hrRepository.getPayrollById(id);
    if (!payroll) return undefined;
    return { ...payroll, items: await hrRepository.getPayrollItems(id) };
};

export const getPayrolls = async (scope: HrScope, query: { restaurant_id?: number; year?: number }): Promise<IPayroll[] | number> => {
    try {
        const restaurantId = scope ?? query.restaurant_id ?? null;
        return await hrRepository.getPayrolls(restaurantId, query.year);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

export const getPayroll = async (id: number, scope: HrScope): Promise<IPayroll | number> => {
    try {
        const payroll = await detail(id);
        if (!payroll || !inScope(payroll.restaurant_id, scope)) return HR_ERROR.PAYROLL_NOT_FOUND;
        return payroll;
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Tính (hoặc tính lại) bảng lương nháp của tháng. Bảng đã chốt thì không tính lại được. */
export const calculatePayroll = async (
    body: { restaurant_id?: number; month: string; note?: string | null },
    scope: HrScope,
    actor: IHrActor,
    audit: IAuditContext,
): Promise<IPayroll | number> => {
    try {
        return await withTransaction(async () => {
            const r = await resolveRestaurant(scope, body.restaurant_id);
            if (typeof r === "number") return rollback(r);
            const month = monthRange(body.month).start;
            // Khóa theo chi nhánh + tháng để hai lần tính đồng thời không chèn trùng
            await hrRepository.lockPayrollMonth(r.id, month);
            let payroll = await hrRepository.getPayrollByMonth(r.id, month, true);
            if (payroll?.status === PayrollStatusEnum.FINALIZED) return rollback(HR_ERROR.PAYROLL_LOCKED);
            if (!payroll) {
                const { id } = await hrRepository.createPayroll({ restaurant_id: r.id, period_month: month, note: body.note ?? null, created_by: actor.userId });
                payroll = (await hrRepository.getPayrollById(id))!;
            }
            const { items } = await computeItems(r.id, month);
            await hrRepository.deletePayrollItems(payroll.id);
            await hrRepository.insertPayrollItems(payroll.id, items);
            await hrRepository.updatePayroll(payroll.id, {
                ...totals(items),
                calculated_at: new Date(),
                created_by: actor.userId,
                ...(body.note !== undefined ? { note: body.note } : {}),
            });
            await writeAudit(audit, {
                action: "payroll.calculate",
                entity_type: "payroll",
                entity_id: payroll.id,
                restaurant_id: r.id,
                after: { period_month: month, ...totals(items) },
            });
            return (await detail(payroll.id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/**
 * Chốt bảng lương (sau khi hết tháng): tính lại lần cuối theo số liệu hiện tại rồi khóa.
 * Từ đó DB chặn mọi thay đổi bảng lương; chấm công, nghỉ phép, thưởng / phạt của tháng cũng không sửa được.
 */
export const finalizePayroll = async (id: number, scope: HrScope, actor: IHrActor, audit: IAuditContext): Promise<IPayroll | number> => {
    try {
        return await withTransaction(async () => {
            const payroll = await hrRepository.getPayrollById(id, true);
            if (!payroll || !inScope(payroll.restaurant_id, scope)) return rollback(HR_ERROR.PAYROLL_NOT_FOUND);
            if (payroll.status !== PayrollStatusEnum.DRAFT) return rollback(HR_ERROR.PAYROLL_LOCKED);
            if (monthRange(payroll.period_month).end >= todayVn()) return rollback(HR_ERROR.PAYROLL_NOT_ENDED);
            const { items, adjustmentIds } = await computeItems(payroll.restaurant_id, payroll.period_month);
            await hrRepository.deletePayrollItems(id);
            await hrRepository.insertPayrollItems(id, items);
            await hrRepository.lockAdjustments(adjustmentIds, id);
            await hrRepository.updatePayroll(id, {
                ...totals(items),
                calculated_at: new Date(),
                status: PayrollStatusEnum.FINALIZED,
                finalized_by: actor.userId,
                finalized_at: new Date(),
            });
            await writeAudit(audit, {
                action: "payroll.finalize",
                entity_type: "payroll",
                entity_id: id,
                restaurant_id: payroll.restaurant_id,
                before: { status: payroll.status, total_net: payroll.total_net },
                after: { status: PayrollStatusEnum.FINALIZED, period_month: payroll.period_month, ...totals(items) },
            });
            return (await detail(id))!;
        });
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

/** Phiếu lương của chính mình (chỉ bảng lương đã chốt) */
export const getMyPayslips = async (userId: number) => {
    try {
        return await hrRepository.getMyPayslips(userId);
    } catch (error) {
        return HR_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Chi phí nhân công cho báo cáo lợi nhuận
// ---------------------------------------------------------------------------

/**
 * Chi phí nhân công của khoảng [from, to]: lấy từ bảng lương (nháp hoặc đã chốt) của các tháng giao với khoảng,
 * chia đều theo ngày trong tháng. `dailyCost(date, restaurantId?)` để chia theo kỳ báo cáo.
 */
export const getLaborCosts = async (from: string, to: string, restaurantId: number | null) => {
    const rows = await hrRepository.getPayrollCosts(from, to, restaurantId);
    const daily = new Map<string, number>(); // `${restaurant}|${YYYY-MM}` -> chi phí / ngày
    for (const r of rows) {
        const { start, end } = monthRange(r.period_month);
        daily.set(`${r.restaurant_id}|${start.slice(0, 7)}`, Number(r.labor_cost) / eachDay(start, end).length);
    }
    const dailyCost = (date: string, restaurant?: number) => {
        let sum = 0;
        for (const [key, value] of daily) {
            const [rid, month] = key.split("|");
            if (month === date.slice(0, 7) && (restaurant === undefined || Number(rid) === restaurant)) sum += value;
        }
        return sum;
    };
    return { payrolls: rows, dailyCost };
};
