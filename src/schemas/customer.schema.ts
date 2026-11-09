import { z } from "zod";
import { FeedbackStatusEnum, OrderRequestStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

/** Giai đoạn 13: kênh khách hàng */

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);

const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const date = z.string({ message: "validation:customer.date.invalid" }).refine(validDay, { message: "validation:customer.date.invalid" });
const time = z.string({ message: "validation:customer.time.invalid" }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "validation:customer.time.invalid" });
const guestCount = z.coerce
    .number({ message: "validation:customer.guest_count.invalid" })
    .int({ message: "validation:customer.guest_count.invalid" })
    .min(1, { message: "validation:customer.guest_count.invalid" })
    .max(500, { message: "validation:customer.guest_count.invalid" });
const email = z.string({ message: "validation:customer.email.invalid" }).trim().toLowerCase().email({ message: "validation:customer.email.invalid" }).max(255);
const phone = z
    .string({ message: "validation:customer.phone.invalid" })
    .trim()
    .regex(/^\+?[0-9\s.-]{8,15}$/, { message: "validation:customer.phone.invalid" });
const rating = z.coerce
    .number({ message: "validation:customer.rating.invalid" })
    .int({ message: "validation:customer.rating.invalid" })
    .min(1, { message: "validation:customer.rating.invalid" })
    .max(5, { message: "validation:customer.rating.invalid" });
const qty = z.coerce
    .number({ message: "validation:customer.quantity.invalid" })
    .int({ message: "validation:customer.quantity.invalid" })
    .min(1, { message: "validation:customer.quantity.invalid" })
    .max(50, { message: "validation:customer.quantity.invalid" });
const token = z.string().trim().min(8).max(64);
const lineNote = optionalString(200);

export const restaurantIdParamSchema = z.object({ params: z.object({ restaurantId: positiveInt() }) });

export const bookingSlotsSchema = z.object({
    params: z.object({ restaurantId: positiveInt() }),
    query: z.object({ date, guest_count: guestCount }),
});

export const bookingOtpSchema = z.object({ body: z.object({ email }) });

export const onlineBookingSchema = z.object({
    body: z.object({
        restaurant_id: positiveInt(),
        date,
        time,
        guest_count: guestCount,
        contact_name: z.preprocess(blankToUndefined, z.string().trim().min(1).max(255, { message: "validation:common.too_long" }).optional()),
        contact_phone: z.preprocess(blankToUndefined, phone.optional()),
        contact_email: z.preprocess(blankToUndefined, email.optional()),
        note: optionalString(500),
        otp_code: z.preprocess(blankToUndefined, z.string().trim().regex(/^\d{6}$/, { message: "validation:customer.otp.invalid" }).optional()),
    }),
});

const lookupCode = z.string().trim().min(6).max(12);

export const bookingLookupSchema = z.object({
    params: z.object({ code: lookupCode }),
    query: z.object({ phone }),
});

export const bookingCancelSchema = z.object({
    params: z.object({ code: lookupCode }),
    body: z.object({ phone, reason: optionalString(500) }),
});

export const tableTokenSchema = z.object({ params: z.object({ token }) });

export const createOrderRequestSchema = z.object({
    params: z.object({ token }),
    body: z
        .object({
            client_token: token,
            guest_count: z.preprocess(blankToNull, guestCount.nullable().optional()),
            note: optionalString(500),
            dishes: z.array(z.object({ dish_id: positiveInt(), quantity: qty, note: lineNote })).max(50).optional(),
            combos: z.array(z.object({ combo_id: positiveInt(), quantity: qty, note: lineNote })).max(50).optional(),
        })
        .refine((b) => (b.dishes?.length ?? 0) + (b.combos?.length ?? 0) > 0, { message: "validation:customer.items.required", path: ["dishes"] }),
});

export const myOrderRequestsSchema = z.object({
    params: z.object({ token }),
    query: z.object({ client_token: token }),
});

const feedbackBody = {
    food_rating: rating,
    service_rating: rating,
    ambience_rating: rating,
    comment: optionalString(2000),
    is_complaint: optionalBoolean(),
    contact_phone: z.preprocess(blankToNull, phone.nullable().optional()),
};

export const tableFeedbackSchema = z.object({
    params: z.object({ token }),
    body: z.object({ order_id: positiveInt(), ...feedbackBody }),
});

export const accountFeedbackSchema = z.object({ params: idParamSchema, body: z.object(feedbackBody) });

export const customerCancelSchema = z.object({ params: idParamSchema, body: z.object({ reason: optionalString(500) }) });

// ---- Nhân viên ----

export const listOrderRequestsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(OrderRequestStatusEnum, { message: "validation:customer.status.invalid" }).optional()),
    }),
});

export const rejectOrderRequestSchema = z.object({ params: idParamSchema, body: z.object({ reason: optionalString(500) }) });

export const listFeedbacksSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        from: z.preprocess(blankToUndefined, date.optional()),
        to: z.preprocess(blankToUndefined, date.optional()),
        status: z.preprocess(blankToUndefined, z.enum(FeedbackStatusEnum, { message: "validation:customer.status.invalid" }).optional()),
        complaint_only: optionalBoolean(),
        max_rating: z.preprocess(blankToUndefined, rating.optional()),
        currentPage: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
        limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).optional()),
    }),
});

export const replyFeedbackSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            reply: optionalString(2000),
            status: z.preprocess(blankToUndefined, z.enum(FeedbackStatusEnum, { message: "validation:customer.status.invalid" }).optional()),
        })
        .refine((b) => b.reply !== undefined || b.status !== undefined, { message: "validation:common.empty_update" }),
});

const intIn = (min: number, max: number) =>
    z.preprocess(
        blankToUndefined,
        z.coerce
            .number({ message: "validation:customer.number.invalid" })
            .int({ message: "validation:customer.number.invalid" })
            .min(min, { message: "validation:customer.number.invalid" })
            .max(max, { message: "validation:customer.number.invalid" })
            .optional(),
    );

export const loyaltySettingsSchema = z.object({
    body: z
        .object({
            enabled: optionalBoolean(),
            earn_amount: intIn(1000, 10_000_000),
            point_value: intIn(1, 10_000_000),
            max_redeem_percent: intIn(0, 100),
            regular_visit_count: intIn(1, 1000),
            regular_window_months: intIn(1, 120),
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const searchGuestsSchema = z.object({
    query: z.object({ q: z.string({ message: "validation:customer.search.required" }).trim().min(2, { message: "validation:customer.search.required" }).max(100) }),
});

export const adjustPointsSchema = z.object({
    params: idParamSchema,
    body: z.object({
        points: z.coerce
            .number({ message: "validation:customer.points.invalid" })
            .int({ message: "validation:customer.points.invalid" })
            .min(-1_000_000, { message: "validation:customer.points.invalid" })
            .max(1_000_000, { message: "validation:customer.points.invalid" })
            .refine((v) => v !== 0, { message: "validation:customer.points.invalid" }),
        note: z.string({ message: "validation:customer.note.required" }).trim().min(1, { message: "validation:customer.note.required" }).max(500),
    }),
});

export const redeemPointsSchema = z.object({
    params: idParamSchema,
    body: z.object({
        points: z.coerce
            .number({ message: "validation:customer.points.invalid" })
            .int({ message: "validation:customer.points.invalid" })
            .min(0, { message: "validation:customer.points.invalid" })
            .max(10_000_000, { message: "validation:customer.points.invalid" }),
    }),
});


export const attachGuestSchema = z.object({
    params: idParamSchema,
    body: z.object({ guest_user_id: z.preprocess(blankToNull, positiveInt().nullable()) }),
});
