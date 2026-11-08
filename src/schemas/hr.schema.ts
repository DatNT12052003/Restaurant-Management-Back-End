import { z } from "zod";
import { AdjustmentTypeEnum, LeaveTypeEnum, OvertimeStatusEnum, PayTypeEnum, ShiftSwapStatusEnum, LeaveStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

/** Giai đoạn 12: nhân sự — ca làm, chấm công, nghỉ phép, lương, đánh giá */

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);

const MAX_MONEY = 9_999_999_999;
/** Khoảng ngày tối đa khi xem lịch / chấm công */
export const MAX_HR_RANGE_DAYS = 62;

const dayNumber = (v: string) => Math.round(Date.parse(`${v}T00:00:00Z`) / 86_400_000);
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

const date = z.string({ message: "validation:hr.date.invalid" }).refine(validDay, { message: "validation:hr.date.invalid" });
const optionalDate = z.preprocess(blankToUndefined, date.optional());

/** "YYYY-MM" (hoặc ngày bất kỳ trong tháng) */
const month = z
    .string({ message: "validation:hr.month.invalid" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, { message: "validation:hr.month.invalid" });

/** "HH:MM" */
const time = z.string({ message: "validation:hr.time.invalid" }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "validation:hr.time.invalid" });
const optionalTime = z.preprocess(blankToUndefined, time.optional());

const dateTime = z
    .string({ message: "validation:hr.datetime.invalid" })
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "validation:hr.datetime.invalid" });

const intRange = (min: number, max: number, message = "validation:hr.number.invalid") =>
    z.coerce.number({ message }).int({ message }).min(min, { message }).max(max, { message });
const optionalInt = (min: number, max: number, message?: string) => z.preprocess(blankToUndefined, intRange(min, max, message).optional());

const money = (allowZero = true) =>
    z.coerce
        .number({ message: "validation:hr.money.invalid" })
        .max(MAX_MONEY, { message: "validation:hr.money.invalid" })
        .refine((v) => (allowZero ? v >= 0 : v > 0), { message: "validation:hr.money.invalid" });

const breakMinutes = optionalInt(0, 480, "validation:hr.break.invalid");
const note = optionalString(1000);
const restaurantId = optionalPositiveInt();
const nonEmpty = (b: Record<string, unknown>) => Object.values(b).some((v) => v !== undefined);

/** from/to bắt buộc, to >= from, tối đa MAX_HR_RANGE_DAYS ngày */
const range = {
    from: date,
    to: date,
};
const rangeOk = (q: { from: string; to: string }) => dayNumber(q.to) >= dayNumber(q.from) && dayNumber(q.to) - dayNumber(q.from) < MAX_HR_RANGE_DAYS;
const RANGE_REFINE = { message: "validation:hr.range.invalid", path: ["to"] };

// ---------------------------------------------------------------------------
// Cấu hình, nhân viên
// ---------------------------------------------------------------------------

export const hrRestaurantQuerySchema = z.object({ query: z.object({ restaurant_id: restaurantId }) });

export const hrStaffQuerySchema = z.object({ query: z.object({ restaurant_id: restaurantId, include_inactive: optionalBoolean() }) });

export const updateHrSettingsSchema = z.object({
    body: z
        .object({
            restaurant_id: restaurantId,
            standard_work_days: optionalInt(1, 31),
            standard_hours_per_day: z.preprocess(
                blankToUndefined,
                z.coerce.number({ message: "validation:hr.number.invalid" }).min(0.5, { message: "validation:hr.number.invalid" }).max(24, { message: "validation:hr.number.invalid" }).optional(),
            ),
            late_grace_minutes: optionalInt(0, 240),
            early_leave_grace_minutes: optionalInt(0, 240),
            late_penalty_amount: z.preprocess(blankToUndefined, money().optional()),
            overtime_threshold_minutes: optionalInt(0, 600),
            overtime_multiplier: z.preprocess(
                blankToUndefined,
                z.coerce.number({ message: "validation:hr.number.invalid" }).min(1, { message: "validation:hr.number.invalid" }).max(5, { message: "validation:hr.number.invalid" }).optional(),
            ),
            early_clock_in_minutes: optionalInt(0, 720),
        })
        .refine(({ restaurant_id, ...rest }) => nonEmpty(rest), { message: "validation:common.empty_update" }),
});

export const rotateQrSchema = z.object({ body: z.object({ restaurant_id: restaurantId }) });

// ---------------------------------------------------------------------------
// Ca mẫu
// ---------------------------------------------------------------------------

const templateName = z
    .string({ message: "validation:hr.template_name.required" })
    .trim()
    .min(1, { message: "validation:hr.template_name.required" })
    .max(100, { message: "validation:common.too_long" });
const activeStatus = z.enum(["active", "inactive"], { message: "validation:hr.status.invalid" });

export const createShiftTemplateSchema = z.object({
    body: z
        .object({ restaurant_id: restaurantId, name: templateName, start_time: time, end_time: time, break_minutes: breakMinutes, status: activeStatus.optional() })
        .refine((b) => b.start_time !== b.end_time, { message: "validation:hr.time.same", path: ["end_time"] }),
});

export const updateShiftTemplateSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ name: templateName.optional(), start_time: optionalTime, end_time: optionalTime, break_minutes: breakMinutes, status: activeStatus.optional() })
        .refine(nonEmpty, { message: "validation:common.empty_update" }),
});

export const hrIdSchema = z.object({ params: idParamSchema });

// ---------------------------------------------------------------------------
// Lịch làm việc
// ---------------------------------------------------------------------------

export const listShiftsSchema = z.object({
    query: z.object({ restaurant_id: restaurantId, user_id: optionalPositiveInt(), ...range }).refine(rangeOk, RANGE_REFINE),
});

export const myRangeSchema = z.object({ query: z.object(range).refine(rangeOk, RANGE_REFINE) });

export const colleagueShiftsSchema = z.object({
    query: z.object({ user_id: positiveInt(), ...range }).refine(rangeOk, RANGE_REFINE),
});

export const createShiftsSchema = z.object({
    body: z
        .object({
            restaurant_id: restaurantId,
            user_ids: z
                .array(positiveInt(), { message: "validation:hr.users.required" })
                .min(1, { message: "validation:hr.users.required" })
                .max(100, { message: "validation:hr.users.required" })
                .refine((ids) => new Set(ids).size === ids.length, { message: "validation:hr.users.duplicate" }),
            dates: z
                .array(date, { message: "validation:hr.dates.required" })
                .min(1, { message: "validation:hr.dates.required" })
                .max(31, { message: "validation:hr.dates.required" })
                .refine((ds) => new Set(ds).size === ds.length, { message: "validation:hr.dates.duplicate" }),
            shift_template_id: z.preprocess(blankToNull, positiveInt().nullable().optional()),
            start_time: optionalTime,
            end_time: optionalTime,
            break_minutes: breakMinutes,
            note,
        })
        .refine((b) => b.shift_template_id || (b.start_time && b.end_time), { message: "validation:hr.time.required", path: ["start_time"] }),
});

export const updateShiftSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            user_id: optionalPositiveInt(),
            work_date: optionalDate,
            shift_template_id: z.preprocess(blankToNull, positiveInt().nullable().optional()),
            start_time: optionalTime,
            end_time: optionalTime,
            break_minutes: breakMinutes,
            note,
        })
        .refine(nonEmpty, { message: "validation:common.empty_update" }),
});

export const copyWeekSchema = z.object({
    body: z
        .object({ restaurant_id: restaurantId, from_week: date, to_week: date })
        .refine((b) => b.from_week !== b.to_week, { message: "validation:hr.week.same", path: ["to_week"] })
        .refine((b) => Math.abs(dayNumber(b.to_week) - dayNumber(b.from_week)) <= 366, { message: "validation:hr.range.invalid", path: ["to_week"] }),
});

// ---------------------------------------------------------------------------
// Đổi ca
// ---------------------------------------------------------------------------

export const createSwapSchema = z.object({
    body: z.object({
        assignment_id: positiveInt(),
        target_user_id: positiveInt(),
        target_assignment_id: z.preprocess(blankToNull, positiveInt().nullable().optional()),
        reason: note,
    }),
});

export const listSwapsSchema = z.object({
    query: z.object({
        restaurant_id: restaurantId,
        status: z.preprocess(blankToUndefined, z.enum(ShiftSwapStatusEnum, { message: "validation:hr.status.invalid" }).optional()),
    }),
});

export const decisionSchema = z.object({ params: idParamSchema, body: z.object({ note }) });

// ---------------------------------------------------------------------------
// Chấm công
// ---------------------------------------------------------------------------

export const clockSchema = z.object({
    body: z.object({
        token: z.string({ message: "validation:hr.qr.required" }).trim().min(1, { message: "validation:hr.qr.required" }).max(200, { message: "validation:hr.qr.required" }),
    }),
});

export const myMonthSchema = z.object({ query: z.object({ month }) });

export const listAttendanceSchema = z.object({
    query: z
        .object({
            restaurant_id: restaurantId,
            user_id: optionalPositiveInt(),
            overtime_status: z.preprocess(blankToUndefined, z.enum(OvertimeStatusEnum, { message: "validation:hr.status.invalid" }).optional()),
            ...range,
        })
        .refine(rangeOk, RANGE_REFINE),
});

const clockOrder = (b: { clock_in_at?: string; clock_out_at?: string | null }) =>
    !b.clock_in_at || !b.clock_out_at || Date.parse(b.clock_out_at) > Date.parse(b.clock_in_at);
const notFuture = (v?: string | null) => !v || Date.parse(v) <= Date.now() + 5 * 60_000;

export const createAttendanceSchema = z.object({
    body: z
        .object({
            restaurant_id: restaurantId,
            user_id: positiveInt(),
            assignment_id: z.preprocess(blankToNull, positiveInt().nullable().optional()),
            clock_in_at: dateTime,
            clock_out_at: z.preprocess(blankToNull, dateTime.nullable().optional()),
            note,
        })
        .refine(clockOrder, { message: "validation:hr.clock.order", path: ["clock_out_at"] })
        .refine((b) => notFuture(b.clock_in_at) && notFuture(b.clock_out_at), { message: "validation:hr.clock.future", path: ["clock_in_at"] }),
});

export const updateAttendanceSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            clock_in_at: z.preprocess(blankToUndefined, dateTime.optional()),
            clock_out_at: z.preprocess(blankToNull, dateTime.nullable().optional()),
            note,
        })
        .refine(nonEmpty, { message: "validation:common.empty_update" })
        .refine(clockOrder, { message: "validation:hr.clock.order", path: ["clock_out_at"] })
        .refine((b) => notFuture(b.clock_in_at) && notFuture(b.clock_out_at), { message: "validation:hr.clock.future", path: ["clock_in_at"] }),
});

export const overtimeDecisionSchema = z.object({
    params: idParamSchema,
    body: z.object({ approve: z.boolean({ message: "validation:common.invalid_boolean" }) }),
});

// ---------------------------------------------------------------------------
// Nghỉ phép
// ---------------------------------------------------------------------------

export const createLeaveSchema = z.object({
    body: z
        .object({
            start_date: date,
            end_date: date,
            type: z.enum(LeaveTypeEnum, { message: "validation:hr.leave_type.invalid" }),
            reason: note,
        })
        .refine((b) => dayNumber(b.end_date) >= dayNumber(b.start_date) && dayNumber(b.end_date) - dayNumber(b.start_date) < 60, {
            message: "validation:hr.leave_range.invalid",
            path: ["end_date"],
        }),
});

export const listLeavesSchema = z.object({
    query: z.object({
        restaurant_id: restaurantId,
        user_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(LeaveStatusEnum, { message: "validation:hr.status.invalid" }).optional()),
        from: optionalDate,
        to: optionalDate,
    }),
});

// ---------------------------------------------------------------------------
// Đánh giá, hiệu suất
// ---------------------------------------------------------------------------

export const monthQuerySchema = z.object({ query: z.object({ restaurant_id: restaurantId, month }) });

export const upsertReviewSchema = z.object({
    body: z.object({
        restaurant_id: restaurantId,
        user_id: positiveInt(),
        month,
        rating: intRange(1, 5, "validation:hr.rating.invalid"),
        comment: optionalString(2000),
    }),
});

// ---------------------------------------------------------------------------
// Lương, phụ cấp, thưởng / phạt, bảng lương
// ---------------------------------------------------------------------------

export const createCompensationSchema = z.object({
    params: idParamSchema,
    body: z.object({
        pay_type: z.enum(PayTypeEnum, { message: "validation:hr.pay_type.invalid" }),
        amount: money(),
        effective_from: date,
        note,
    }),
});

const allowanceName = z
    .string({ message: "validation:hr.allowance_name.required" })
    .trim()
    .min(1, { message: "validation:hr.allowance_name.required" })
    .max(100, { message: "validation:common.too_long" });

export const createAllowanceSchema = z.object({
    params: idParamSchema,
    body: z.object({ name: allowanceName, amount: money(false), status: activeStatus.optional() }),
});

export const updateAllowanceSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ name: allowanceName.optional(), amount: z.preprocess(blankToUndefined, money(false).optional()), status: activeStatus.optional() })
        .refine(nonEmpty, { message: "validation:common.empty_update" }),
});

export const listAdjustmentsSchema = z.object({ query: z.object({ restaurant_id: restaurantId, user_id: optionalPositiveInt(), month }) });

export const createAdjustmentSchema = z.object({
    body: z.object({
        restaurant_id: restaurantId,
        user_id: positiveInt(),
        type: z.enum(AdjustmentTypeEnum, { message: "validation:hr.adjustment_type.invalid" }),
        amount: money(false),
        reason: z
            .string({ message: "validation:hr.reason.required" })
            .trim()
            .min(1, { message: "validation:hr.reason.required" })
            .max(1000, { message: "validation:common.too_long" }),
        effective_date: date,
    }),
});

export const listPayrollsSchema = z.object({
    query: z.object({ restaurant_id: restaurantId, year: optionalInt(2000, 2100) }),
});

export const calculatePayrollSchema = z.object({
    body: z.object({ restaurant_id: restaurantId, month, note }),
});
