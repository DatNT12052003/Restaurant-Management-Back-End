import { z } from "zod";
import { idParamSchema, optionalPositiveInt, optionalString } from "./common.schema";

/** Giai đoạn 14: chuyển khoản QR, đối soát, hóa đơn điện tử */

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const dateTime = z.coerce.date({ message: "validation:reservation.time.invalid" });

export const createQrPaymentSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            amount: z.preprocess(
                blankToUndefined,
                z.coerce
                    .number({ message: "validation:payment.amount.invalid" })
                    .positive({ message: "validation:payment.amount.invalid" })
                    .max(9_999_999_999, { message: "validation:payment.amount.invalid" })
                    .optional(),
            ),
        })
        .default({}),
});

export const listGatewayTransactionsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(["matched", "unmatched", "mismatch", "ignored", "open"]).optional()),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});

export const applyGatewayTransactionSchema = z.object({
    params: idParamSchema,
    body: z.object({
        order_id: z.coerce
            .number({ message: "validation:common.invalid_id" })
            .int({ message: "validation:common.invalid_id" })
            .positive({ message: "validation:common.invalid_id" }),
    }),
});

export const ignoreGatewayTransactionSchema = z.object({
    params: idParamSchema,
    body: z.object({ note: optionalString(500) }).default({}),
});

/** Mã số thuế: 10 số, chi nhánh thêm "-xxx" */
const taxCode = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
        .string()
        .trim()
        .regex(/^\d{10}(-\d{3})?$/, { message: "validation:einvoice.tax_code.invalid" })
        .nullable()
        .optional(),
);

const email = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().email({ message: "validation:einvoice.email.invalid" }).max(255).nullable().optional(),
);

export const issueEInvoiceSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            buyer_type: z.enum(["individual", "company"], { message: "validation:einvoice.buyer_type.invalid" }).default("individual"),
            buyer_name: optionalString(255),
            buyer_company: optionalString(255),
            buyer_tax_code: taxCode,
            buyer_address: optionalString(1000),
            buyer_email: email,
            buyer_phone: optionalString(30),
        })
        .refine((b) => b.buyer_type !== "company" || (b.buyer_company && b.buyer_tax_code), {
            message: "validation:einvoice.company.required",
            path: ["buyer_company"],
        }),
});

export const eInvoiceIdSchema = z.object({ params: idParamSchema });

export const cancelEInvoiceSchema = z.object({
    params: idParamSchema,
    body: z.object({
        reason: z
            .string({ message: "validation:einvoice.reason.required" })
            .trim()
            .min(1, { message: "validation:einvoice.reason.required" })
            .max(1000, { message: "validation:common.too_long" }),
    }),
});

export const listEInvoicesSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        order_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(["pending", "issued", "failed", "cancelled"]).optional()),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});
