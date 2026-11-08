import { z } from "zod";
import { idParamSchema, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Định lượng 1 phần: > 0, tối đa 3 chữ số thập phân (theo đơn vị của nguyên liệu) */
const quantity = z.coerce
    .number({ message: "validation:recipe.quantity.invalid" })
    .positive({ message: "validation:recipe.quantity.invalid" })
    .max(100_000, { message: "validation:recipe.quantity.invalid" })
    .refine((v) => Math.round(v * 1000) === v * 1000 || Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, {
        message: "validation:recipe.quantity.invalid",
    });

export const recipeQuerySchema = z.object({
    params: idParamSchema,
    query: z.object({ restaurant_id: optionalPositiveInt() }),
});

export const updateRecipeSchema = z.object({
    params: idParamSchema,
    body: z.object({
        items: z
            .array(z.object({ ingredient_id: positiveInt(), quantity }), { message: "validation:common.invalid_list" })
            .max(50, { message: "validation:common.invalid_list" })
            .refine((items) => new Set(items.map((i) => i.ingredient_id)).size === items.length, {
                message: "validation:recipe.duplicate_ingredient",
            }),
    }),
});

export const menuCostsSchema = z.object({
    query: z.object({ restaurant_id: optionalPositiveInt() }),
});

// ---- Ngày nghỉ của chi nhánh ----

const day = z
    .string({ message: "validation:restaurant.closed_day.invalid" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "validation:restaurant.closed_day.invalid" })
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: "validation:restaurant.closed_day.invalid" });

const restaurantParam = z.object({ restaurantId: positiveInt() });

export const listClosedDaysSchema = z.object({
    params: restaurantParam,
    query: z.object({
        from: z.preprocess(blankToUndefined, day.optional()),
        to: z.preprocess(blankToUndefined, day.optional()),
    }),
});

export const createClosedDaySchema = z.object({
    params: restaurantParam,
    body: z.object({ day, note: optionalString(255) }),
});

export const deleteClosedDaySchema = z.object({
    params: restaurantParam.extend({ day }),
});
