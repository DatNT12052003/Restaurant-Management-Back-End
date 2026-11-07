import { z } from "zod";
import { DiscountStatusEnum, DiscountTypeEnum, PaymentMethodEnum, PaymentStatusEnum, PaymentTypeEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString } from "./common.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);

const MAX_MONEY = 9_999_999_999;

const money = (message = "validation:payment.amount.invalid") =>
    z.coerce.number({ message }).positive({ message }).max(MAX_MONEY, { message });

const nullableMoney = (message: string) => z.preprocess(blankToNull, money(message).nullable().optional());

const nullableCount = z.preprocess(
    blankToNull,
    z.coerce
        .number({ message: "validation:discount.limit.invalid" })
        .int({ message: "validation:discount.limit.invalid" })
        .positive({ message: "validation:discount.limit.invalid" })
        .max(1_000_000, { message: "validation:discount.limit.invalid" })
        .nullable()
        .optional(),
);

const dateTime = z.coerce.date({ message: "validation:reservation.time.invalid" });

// ---------------------------------------------------------------------------
// Mã giảm giá
// ---------------------------------------------------------------------------

/** Mã: chữ, số, `-`, `_`; lưu dạng IN HOA */
const code = z
    .string({ message: "validation:discount.code.invalid" })
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,50}$/, { message: "validation:discount.code.invalid" })
    .transform((v) => v.toUpperCase());

const discountName = z
    .string({ message: "validation:discount.name.required" })
    .trim()
    .min(1, { message: "validation:discount.name.required" })
    .max(255, { message: "validation:common.too_long" });

const discountFields = {
    description: optionalString(2000),
    // null = cả chuỗi (chỉ admin); người bị giới hạn luôn dùng nhà hàng của mình
    restaurant_id: z.preprocess(blankToNull, z.coerce.number().int().positive().nullable().optional()),
    min_order_value: z.preprocess(
        blankToUndefined,
        z.coerce
            .number({ message: "validation:discount.min_order.invalid" })
            .min(0, { message: "validation:discount.min_order.invalid" })
            .max(MAX_MONEY, { message: "validation:discount.min_order.invalid" })
            .optional(),
    ),
    max_discount: nullableMoney("validation:discount.max_discount.invalid"),
    start_at: z.preprocess(blankToUndefined, dateTime.optional()),
    end_at: z.preprocess(blankToNull, dateTime.nullable().optional()),
    usage_limit: nullableCount,
    per_user_limit: nullableCount,
    status: z.enum(DiscountStatusEnum, { message: "validation:discount.status.invalid" }).optional(),
};

/** percent: 1 – 100; fixed: số tiền dương */
const validValue = (b: { type?: string; value?: number }) =>
    b.type !== DiscountTypeEnum.PERCENT || b.value === undefined || b.value <= 100;
const validWindow = (b: { start_at?: Date; end_at?: Date | null }) =>
    !b.start_at || !b.end_at || b.end_at.getTime() > b.start_at.getTime();

export const createDiscountSchema = z.object({
    body: z
        .object({
            code,
            name: discountName,
            type: z.enum(DiscountTypeEnum, { message: "validation:discount.type.invalid" }),
            value: money("validation:discount.value.invalid"),
            ...discountFields,
        })
        .refine(validValue, { message: "validation:discount.value.percent", path: ["value"] })
        .refine(validWindow, { message: "validation:reservation.time.end_before_start", path: ["end_at"] }),
});

export const updateDiscountSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            code: code.optional(),
            name: discountName.optional(),
            type: z.enum(DiscountTypeEnum, { message: "validation:discount.type.invalid" }).optional(),
            value: money("validation:discount.value.invalid").optional(),
            ...discountFields,
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" })
        .refine(validValue, { message: "validation:discount.value.percent", path: ["value"] })
        .refine(validWindow, { message: "validation:reservation.time.end_before_start", path: ["end_at"] }),
});

export const discountIdSchema = z.object({ params: idParamSchema });

export const listDiscountsSchema = z.object({
    query: z.object({ restaurant_id: optionalPositiveInt() }),
});

export const applyDiscountSchema = z.object({
    params: idParamSchema,
    body: z.object({
        code: z
            .string({ message: "validation:discount.code.invalid" })
            .trim()
            .min(1, { message: "validation:discount.code.invalid" })
            .max(50, { message: "validation:discount.code.invalid" }),
    }),
});

// ---------------------------------------------------------------------------
// Thanh toán
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.object({
    params: idParamSchema,
    body: z.object({
        method: z.enum(PaymentMethodEnum, { message: "validation:payment.method.invalid" }),
        amount: money(),
        received_amount: nullableMoney("validation:payment.received.invalid"),
        reference: optionalString(100),
        note: optionalString(1000),
        confirm: optionalBoolean(),
    }),
});

export const paymentIdSchema = z.object({ params: idParamSchema });

export const refundPaymentSchema = z.object({
    params: idParamSchema,
    body: z.object({
        amount: money(),
        reason: z
            .string({ message: "validation:payment.reason.required" })
            .trim()
            .min(1, { message: "validation:payment.reason.required" })
            .max(1000, { message: "validation:common.too_long" }),
    }),
});

/** GET /payments: tham số riêng ngoài bộ lọc chung */
export const listPaymentsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        order_id: optionalPositiveInt(),
        method: z.preprocess(blankToUndefined, z.enum(PaymentMethodEnum).optional()),
        status: z.preprocess(blankToUndefined, z.enum(PaymentStatusEnum).optional()),
        type: z.preprocess(blankToUndefined, z.enum(PaymentTypeEnum).optional()),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});
