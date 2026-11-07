import { z } from "zod";
import { MAX_RESERVATION_HOURS, MAX_SCHEDULE_RANGE_DAYS } from "~/common/constant";
import { ReservationStatusEnum, RoomTypeEnum } from "~/common/enum";
import { idParamSchema, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);

/** Nhận chuỗi ISO 8601 (nên có múi giờ, ví dụ `2026-11-08T11:30:00.000Z`) */
const dateTime = z.coerce.date({ message: "validation:reservation.time.invalid" });

const guestCount = z.coerce
    .number({ message: "validation:reservation.guest_count.invalid" })
    .int({ message: "validation:reservation.guest_count.invalid" })
    .min(1, { message: "validation:reservation.guest_count.invalid" })
    .max(500, { message: "validation:reservation.guest_count.invalid" });

const contactPhone = z.preprocess(
    blankToNull,
    z
        .string()
        .trim()
        .regex(/^\+?[0-9 .-]{8,20}$/, { message: "validation:user.phone_number.invalid" })
        .nullable()
        .optional(),
);

const tableIds = z
    .array(positiveInt(), { message: "validation:reservation.tables.required" })
    .min(1, { message: "validation:reservation.tables.required" })
    .max(20, { message: "validation:common.invalid_list" })
    .refine((ids) => new Set(ids).size === ids.length, { message: "validation:reservation.tables.duplicate" });

const guestUserId = z.preprocess(blankToNull, positiveInt().nullable().optional());

/** Kiểm tra khoảng thời gian khi có đủ cả hai đầu */
const validRange = (b: { start_time?: Date; end_time?: Date }) =>
    !b.start_time || !b.end_time || b.end_time.getTime() > b.start_time.getTime();
const withinMaxDuration = (b: { start_time?: Date; end_time?: Date }) =>
    !b.start_time || !b.end_time || b.end_time.getTime() - b.start_time.getTime() <= MAX_RESERVATION_HOURS * HOUR;

const rangeChecks = <T extends z.ZodType<{ start_time?: Date; end_time?: Date }>>(schema: T) =>
    schema
        .refine(validRange, { message: "validation:reservation.time.end_before_start", path: ["end_time"] })
        .refine(withinMaxDuration, {
            message: "validation:reservation.time.too_long",
            path: ["end_time"],
        });

export const createReservationSchema = z.object({
    body: rangeChecks(
        z.object({
            // Bắt buộc với admin; người bị giới hạn nhà hàng thì tự lấy nhà hàng của mình
            restaurant_id: optionalPositiveInt(),
            guest_user_id: guestUserId,
            contact_name: optionalString(255),
            contact_phone: contactPhone,
            guest_count: guestCount,
            start_time: dateTime,
            end_time: dateTime,
            note: optionalString(2000),
            status: z
                .enum([ReservationStatusEnum.PENDING, ReservationStatusEnum.CONFIRMED], {
                    message: "validation:reservation.status.invalid",
                })
                .optional(),
            table_ids: tableIds,
        }),
    ),
});

export const updateReservationSchema = z.object({
    params: idParamSchema,
    body: rangeChecks(
        z
            .object({
                guest_user_id: guestUserId,
                contact_name: optionalString(255),
                contact_phone: contactPhone,
                guest_count: guestCount.optional(),
                start_time: dateTime.optional(),
                end_time: dateTime.optional(),
                note: optionalString(2000),
                table_ids: tableIds.optional(),
            })
            .refine((b) => Object.values(b).some((v) => v !== undefined), {
                message: "validation:common.empty_update",
            }),
    ),
});

export const updateReservationStatusSchema = z.object({
    params: idParamSchema,
    body: z.object({
        status: z.enum(ReservationStatusEnum, { message: "validation:reservation.status.invalid" }),
        cancel_reason: optionalString(1000),
    }),
});

export const reservationIdSchema = z.object({ params: idParamSchema });

/** GET /reservations: các tham số riêng ngoài bộ lọc chung (search, filters, orderBy, phân trang) */
export const listReservationsSchema = z.object({
    query: z
        .object({
            restaurant_id: optionalPositiveInt(),
            table_id: optionalPositiveInt(),
            from: z.preprocess(blankToUndefined, dateTime.optional()),
            to: z.preprocess(blankToUndefined, dateTime.optional()),
        })
        .loose(),
});

export const reservationScheduleSchema = z.object({
    query: z
        .object({
            restaurant_id: optionalPositiveInt(),
            from: dateTime,
            to: dateTime,
        })
        .refine((q) => q.to.getTime() > q.from.getTime(), {
            message: "validation:reservation.time.end_before_start",
            path: ["to"],
        })
        .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_SCHEDULE_RANGE_DAYS * DAY, {
            message: "validation:reservation.time.range_too_long",
            path: ["to"],
        }),
});

export const availableTablesSchema = z.object({
    query: rangeChecks(
        z.object({
            restaurant_id: optionalPositiveInt(),
            start_time: dateTime,
            end_time: dateTime,
            guest_count: z.preprocess(blankToUndefined, guestCount.optional()),
            room_type: z.preprocess(
                blankToUndefined,
                z.enum(RoomTypeEnum, { message: "validation:room.type.invalid" }).optional(),
            ),
            exclude_reservation_id: optionalPositiveInt(),
        }),
    ),
});
