import { z } from "zod";
import { IngredientStatusEnum, InventoryReceiptTypeEnum, InventoryTransactionTypeEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

const MAX_QTY = 99_999_999;
const MAX_MONEY = 9_999_999_999;

const quantity = (min: "positive" | "nonnegative") => {
    const base = z.coerce
        .number({ message: "validation:inventory.quantity.invalid" })
        .max(MAX_QTY, { message: "validation:inventory.quantity.invalid" })
        // Tối đa 3 chữ số thập phân (khớp numeric(14,3))
        .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, { message: "validation:inventory.quantity.decimals" });
    return min === "positive"
        ? base.refine((v) => v > 0, { message: "validation:inventory.quantity.invalid" })
        : base.refine((v) => v >= 0, { message: "validation:inventory.quantity.invalid" });
};

const unitPrice = z.coerce
    .number({ message: "validation:inventory.unit_price.invalid" })
    .min(0, { message: "validation:inventory.unit_price.invalid" })
    .max(MAX_MONEY, { message: "validation:inventory.unit_price.invalid" });

// ---- Nguyên liệu ----

const name = z
    .string({ message: "validation:inventory.name.required" })
    .trim()
    .min(1, { message: "validation:inventory.name.required" })
    .max(255, { message: "validation:common.too_long" });

const unit = z
    .string({ message: "validation:inventory.unit.required" })
    .trim()
    .min(1, { message: "validation:inventory.unit.required" })
    .max(20, { message: "validation:common.too_long" });

const ingredientStatus = z.enum(IngredientStatusEnum, { message: "validation:inventory.status.invalid" });

const shelfLife = z.preprocess(
    (v) => (v === "" ? null : v),
    z.coerce
        .number({ message: "validation:inventory.shelf_life.invalid" })
        .int({ message: "validation:inventory.shelf_life.invalid" })
        .min(1, { message: "validation:inventory.shelf_life.invalid" })
        .max(3650, { message: "validation:inventory.shelf_life.invalid" })
        .nullable()
        .optional(),
);

export const createIngredientSchema = z.object({
    body: z.object({
        name,
        unit,
        description: optionalString(2000),
        status: ingredientStatus.optional(),
        track_expiry: optionalBoolean(),
        shelf_life_days: shelfLife,
    }),
});

export const updateIngredientSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: name.optional(),
            unit: unit.optional(),
            description: optionalString(2000),
            status: ingredientStatus.optional(),
            track_expiry: optionalBoolean(),
            shelf_life_days: shelfLife,
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const ingredientIdSchema = z.object({ params: idParamSchema });

// ---- Tồn kho ----

export const stockSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        low_only: optionalBoolean(),
        include_inactive: optionalBoolean(),
    }),
});

export const updateStockSettingSchema = z.object({
    body: z.object({
        restaurant_id: optionalPositiveInt(),
        ingredient_id: positiveInt(),
        min_quantity: quantity("nonnegative"),
    }),
});

// ---- Phiếu kho ----

/** Hạn dùng của lô: YYYY-MM-DD */
export const expiryDate = z
    .string({ message: "validation:inventory.expiry.invalid" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "validation:inventory.expiry.invalid" })
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: "validation:inventory.expiry.invalid" });

const lines = z
    .array(
        z.object({
            ingredient_id: positiveInt(),
            quantity: quantity("nonnegative"),
            unit_price: z.preprocess(blankToUndefined, unitPrice.optional()),
            note: optionalString(500),
            expiry_date: z.preprocess((v) => (v === "" ? null : v), expiryDate.nullable().optional()),
            lot_code: optionalString(60),
            lot_id: optionalPositiveInt(),
        }),
        { message: "validation:inventory.lines.required" },
    )
    .min(1, { message: "validation:inventory.lines.required" })
    .max(200, { message: "validation:common.invalid_list" })
    .refine((ls) => new Set(ls.map((l) => l.ingredient_id)).size === ls.length, {
        message: "validation:inventory.lines.duplicate",
    });

export const createReceiptSchema = z.object({
    body: z
        .object({
            restaurant_id: optionalPositiveInt(),
            type: z.enum(InventoryReceiptTypeEnum, { message: "validation:inventory.type.invalid" }),
            supplier: optionalString(255),
            supplier_id: optionalPositiveInt(),
            reason: optionalString(1000),
            note: optionalString(2000),
            lines,
        })
        // Nhập / xuất: số lượng > 0; kiểm kê: số thực tế >= 0
        .refine((b) => b.type === InventoryReceiptTypeEnum.ADJUST || b.lines.every((l) => l.quantity > 0), {
            message: "validation:inventory.quantity.invalid",
            path: ["lines"],
        })
        .refine((b) => b.type !== InventoryReceiptTypeEnum.IMPORT || b.lines.every((l) => l.unit_price !== undefined), {
            message: "validation:inventory.unit_price.required",
            path: ["lines"],
        })
        // Xuất kho và kiểm kê phải có lý do (đặc tả 4.5)
        .refine((b) => b.type === InventoryReceiptTypeEnum.IMPORT || !!b.reason, {
            message: "validation:inventory.reason.required",
            path: ["reason"],
        }),
});

export const receiptIdSchema = z.object({ params: idParamSchema });

/** GET /inventory/lots: lô còn hàng; `expiring_days`: chỉ lô hết hạn trong số ngày tới (gồm cả lô đã hết hạn) */
export const listLotsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        ingredient_id: optionalPositiveInt(),
        expiring_days: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(365).optional()),
    }),
});

const dateTime = z.coerce.date({ message: "validation:reservation.time.invalid" });

export const listReceiptsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        type: z.preprocess(blankToUndefined, z.enum(InventoryReceiptTypeEnum).optional()),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});

export const listInventoryTransactionsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        ingredient_id: optionalPositiveInt(),
        type: z.preprocess(blankToUndefined, z.enum(InventoryTransactionTypeEnum).optional()),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});
