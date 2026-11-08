import { z } from "zod";
import { PaymentMethodEnum, PurchaseOrderStatusEnum, StockTransferStatusEnum, SupplierBillStatusEnum, SupplierStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";
import { expiryDate } from "./inventory.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

const MAX_QTY = 99_999_999;
const MAX_MONEY = 9_999_999_999;

/** Số lượng > 0 (hoặc >= 0), tối đa 3 chữ số thập phân */
const quantity = (allowZero = false) =>
    z.coerce
        .number({ message: "validation:inventory.quantity.invalid" })
        .max(MAX_QTY, { message: "validation:inventory.quantity.invalid" })
        .refine((v) => (allowZero ? v >= 0 : v > 0), { message: "validation:inventory.quantity.invalid" })
        .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, { message: "validation:inventory.quantity.decimals" });

const money = (allowZero = true) =>
    z.coerce
        .number({ message: "validation:inventory.unit_price.invalid" })
        .max(MAX_MONEY, { message: "validation:inventory.unit_price.invalid" })
        .refine((v) => (allowZero ? v >= 0 : v > 0), { message: "validation:inventory.unit_price.invalid" });

/** Không trùng nguyên liệu / dòng trong cùng danh sách */
const uniqueIngredient = (items: { ingredient_id: number }[]) => new Set(items.map((i) => i.ingredient_id)).size === items.length;
const uniqueLine = (items: { line_id: number }[]) => new Set(items.map((i) => i.line_id)).size === items.length;

const day = z.preprocess(
    (v) => (v === "" ? null : v),
    z
        .string({ message: "validation:purchasing.date.invalid" })
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "validation:purchasing.date.invalid" })
        .nullable()
        .optional(),
);

// ---------------------------------------------------------------------------
// Nhà cung cấp
// ---------------------------------------------------------------------------

const supplierName = z
    .string({ message: "validation:purchasing.supplier_name.required" })
    .trim()
    .min(1, { message: "validation:purchasing.supplier_name.required" })
    .max(255, { message: "validation:common.too_long" });

const supplierFields = {
    contact_name: optionalString(255),
    phone: optionalString(30),
    email: z.preprocess(
        (v) => (v === "" ? null : v),
        z.string().trim().email({ message: "validation:purchasing.email.invalid" }).max(255).nullable().optional(),
    ),
    address: optionalString(1000),
    tax_code: optionalString(30),
    payment_terms_days: z.preprocess(
        blankToUndefined,
        z.coerce
            .number({ message: "validation:purchasing.terms.invalid" })
            .int({ message: "validation:purchasing.terms.invalid" })
            .min(0, { message: "validation:purchasing.terms.invalid" })
            .max(365, { message: "validation:purchasing.terms.invalid" })
            .optional(),
    ),
    note: optionalString(2000),
    status: z.enum(SupplierStatusEnum, { message: "validation:purchasing.status.invalid" }).optional(),
};

export const createSupplierSchema = z.object({ body: z.object({ name: supplierName, ...supplierFields }) });

export const updateSupplierSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ name: supplierName.optional(), ...supplierFields })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const supplierIdSchema = z.object({ params: idParamSchema });

export const listSuppliersSchema = z.object({
    query: z.object({
        search: optionalString(255),
        status: z.preprocess(blankToUndefined, z.enum(SupplierStatusEnum).optional()),
    }),
});

export const supplierPricesSchema = z.object({
    params: idParamSchema,
    body: z.object({
        items: z
            .array(z.object({ ingredient_id: positiveInt(), unit_price: money(), is_preferred: optionalBoolean() }), {
                message: "validation:common.invalid_list",
            })
            .max(500, { message: "validation:common.invalid_list" })
            .refine(uniqueIngredient, { message: "validation:inventory.lines.duplicate" }),
    }),
});

export const ingredientPricesSchema = z.object({ params: idParamSchema });

// ---------------------------------------------------------------------------
// Đơn đặt hàng
// ---------------------------------------------------------------------------

const poLines = z
    .array(
        z.object({
            ingredient_id: positiveInt(),
            quantity: quantity(),
            unit_price: z.preprocess(blankToUndefined, money().optional()),
        }),
        { message: "validation:inventory.lines.required" },
    )
    .min(1, { message: "validation:inventory.lines.required" })
    .max(200, { message: "validation:common.invalid_list" })
    .refine(uniqueIngredient, { message: "validation:inventory.lines.duplicate" });

export const createPurchaseOrderSchema = z.object({
    body: z.object({
        restaurant_id: optionalPositiveInt(),
        supplier_id: positiveInt(),
        expected_date: day,
        note: optionalString(2000),
        lines: poLines,
        // Gửi luôn (bỏ qua bước nháp)
        send: optionalBoolean(),
    }),
});

export const updatePurchaseOrderSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ supplier_id: optionalPositiveInt(), expected_date: day, note: optionalString(2000), lines: poLines.optional() })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const purchaseOrderIdSchema = z.object({ params: idParamSchema });

export const purchaseOrderActionSchema = z.object({
    params: idParamSchema,
    body: z.object({ reason: optionalString(1000) }),
});

export const receivePurchaseOrderSchema = z.object({
    params: idParamSchema,
    body: z.object({
        note: optionalString(2000),
        lines: z
            .array(
                z.object({
                    line_id: positiveInt(),
                    quantity: quantity(true),
                    unit_price: z.preprocess(blankToUndefined, money().optional()),
                    expiry_date: z.preprocess((v) => (v === "" ? null : v), expiryDate.nullable().optional()),
                    lot_code: optionalString(60),
                }),
                { message: "validation:inventory.lines.required" },
            )
            .min(1, { message: "validation:inventory.lines.required" })
            .max(200, { message: "validation:common.invalid_list" })
            .refine(uniqueLine, { message: "validation:inventory.lines.duplicate" }),
    }),
});

export const listPurchaseOrdersSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        supplier_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(PurchaseOrderStatusEnum).optional()),
    }),
});

export const purchaseSuggestionsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        supplier_id: optionalPositiveInt(),
        cover_days: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(90).optional()),
        lookback_days: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(90).optional()),
    }),
});

// ---------------------------------------------------------------------------
// Chuyển kho
// ---------------------------------------------------------------------------

export const createTransferSchema = z.object({
    body: z.object({
        from_restaurant_id: optionalPositiveInt(),
        to_restaurant_id: positiveInt(),
        note: optionalString(2000),
        lines: z
            .array(z.object({ ingredient_id: positiveInt(), quantity: quantity() }), { message: "validation:inventory.lines.required" })
            .min(1, { message: "validation:inventory.lines.required" })
            .max(200, { message: "validation:common.invalid_list" })
            .refine(uniqueIngredient, { message: "validation:inventory.lines.duplicate" }),
    }),
});

export const transferIdSchema = z.object({ params: idParamSchema });

export const receiveTransferSchema = z.object({
    params: idParamSchema,
    body: z.object({
        note: optionalString(2000),
        lines: z
            .array(z.object({ line_id: positiveInt(), received_quantity: quantity(true) }), { message: "validation:common.invalid_list" })
            .max(200, { message: "validation:common.invalid_list" })
            .refine(uniqueLine, { message: "validation:inventory.lines.duplicate" })
            .optional(),
    }),
});

export const listTransfersSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(StockTransferStatusEnum).optional()),
    }),
});

// ---------------------------------------------------------------------------
// Công nợ
// ---------------------------------------------------------------------------

export const listBillsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        supplier_id: optionalPositiveInt(),
        status: z.preprocess(blankToUndefined, z.enum(SupplierBillStatusEnum).optional()),
        overdue: optionalBoolean(),
    }),
});

export const billIdSchema = z.object({ params: idParamSchema });

export const payBillSchema = z.object({
    params: idParamSchema,
    body: z.object({
        amount: money(false),
        method: z.enum(PaymentMethodEnum, { message: "validation:payment.method.invalid" }),
        reference: optionalString(100),
        note: optionalString(1000),
        paid_at: z.preprocess(blankToUndefined, z.coerce.date({ message: "validation:purchasing.date.invalid" }).optional()),
    }),
});
