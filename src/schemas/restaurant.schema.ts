import { z } from "zod";
import { RestaurantStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalString } from "./common.schema";

const name = z
    .string({ message: "validation:restaurant.name.required" })
    .trim()
    .min(1, { message: "validation:restaurant.name.required" })
    .max(255, { message: "validation:common.too_long" });

const address = z
    .string({ message: "validation:restaurant.address.required" })
    .trim()
    .min(1, { message: "validation:restaurant.address.required" })
    .max(1000, { message: "validation:common.too_long" });

const status = z.enum(RestaurantStatusEnum, { message: "validation:restaurant.status.invalid" });

/** Phí dịch vụ / thuế (%), 0 – 100 */
const percent = z.coerce
    .number({ message: "validation:restaurant.percent.invalid" })
    .min(0, { message: "validation:restaurant.percent.invalid" })
    .max(100, { message: "validation:restaurant.percent.invalid" });

/** Giờ "HH:mm" hoặc "HH:mm:ss" */
const time = z
    .string({ message: "validation:restaurant.time.invalid" })
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, { message: "validation:restaurant.time.invalid" });

/** Số phút giữ bàn / chờ khách trễ, 0 – 240 (0 = tắt) */
const minutes = z.coerce
    .number({ message: "validation:restaurant.minutes.invalid" })
    .int({ message: "validation:restaurant.minutes.invalid" })
    .min(0, { message: "validation:restaurant.minutes.invalid" })
    .max(240, { message: "validation:restaurant.minutes.invalid" });

/** Giai đoạn 13: số nguyên trong khoảng (đặt bàn online) */
const intRange = (min: number, max: number) =>
    z.coerce
        .number({ message: "validation:restaurant.number.invalid" })
        .int({ message: "validation:restaurant.number.invalid" })
        .min(min, { message: "validation:restaurant.number.invalid" })
        .max(max, { message: "validation:restaurant.number.invalid" })
        .optional();

/** Giai đoạn 14: tài khoản nhận chuyển khoản QR và thông tin người bán trên hóa đơn điện tử */
const bankBin = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().regex(/^\d{6}$/, { message: "validation:restaurant.bank_bin.invalid" }).nullable().optional(),
);
const integrationFields = {
    bank_bin: bankBin,
    bank_account_no: z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().regex(/^[0-9A-Za-z]{4,30}$/, { message: "validation:restaurant.bank_account_no.invalid" }).nullable().optional(),
    ),
    bank_account_name: optionalString(100),
    transfer_qr_enabled: optionalBoolean(),
    legal_name: optionalString(255),
    tax_code: z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().regex(/^\d{10}(-\d{3})?$/, { message: "validation:restaurant.tax_code.invalid" }).nullable().optional(),
    ),
    einvoice_series: optionalString(20),
    einvoice_auto_issue: optionalBoolean(),
};

export const createRestaurantSchema = z.object({
    body: z.object({
        name,
        address,
        status: status.optional(),
        service_fee_percent: percent.optional(),
        tax_percent: percent.optional(),
        open_time: time.optional(),
        close_time: time.optional(),
        reservation_hold_minutes: minutes.optional(),
        no_show_after_minutes: minutes.optional(),
        phone: optionalString(30),
        online_booking_enabled: optionalBoolean(),
        online_booking_minutes: intRange(30, 720),
        online_booking_lead_minutes: intRange(0, 10080),
        online_booking_max_days: intRange(1, 365),
        online_booking_max_guests: intRange(1, 500),
        qr_ordering_enabled: optionalBoolean(),
        ...integrationFields,
    }),
});

export const updateRestaurantSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: name.optional(),
            address: address.optional(),
            status: status.optional(),
            service_fee_percent: percent.optional(),
            tax_percent: percent.optional(),
            open_time: time.optional(),
            close_time: time.optional(),
            reservation_hold_minutes: minutes.optional(),
            no_show_after_minutes: minutes.optional(),
            phone: optionalString(30),
            online_booking_enabled: optionalBoolean(),
            online_booking_minutes: intRange(30, 720),
            online_booking_lead_minutes: intRange(0, 10080),
            online_booking_max_days: intRange(1, 365),
            online_booking_max_guests: intRange(1, 500),
            qr_ordering_enabled: optionalBoolean(),
            ...integrationFields,
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const restaurantIdSchema = z.object({ params: idParamSchema });
