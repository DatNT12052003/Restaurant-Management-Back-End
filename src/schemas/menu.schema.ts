import { z } from "zod";
import { DishCategoryEnum, ImageEntityEnum, MenuItemStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalString, positiveInt } from "./common.schema";

const name = (max = 255) =>
    z
        .string({ message: "validation:menu.name.required" })
        .trim()
        .min(1, { message: "validation:menu.name.required" })
        .max(max, { message: "validation:common.too_long" });

const price = z.coerce
    .number({ message: "validation:menu.price.invalid" })
    .min(0, { message: "validation:menu.price.invalid" })
    .max(9_999_999_999, { message: "validation:menu.price.invalid" });

const status = z.enum(MenuItemStatusEnum, { message: "validation:menu.status.invalid" });
const category = z.enum(DishCategoryEnum, { message: "validation:menu.category.invalid" });

const idList = z
    .array(positiveInt(), { message: "validation:common.invalid_list" })
    .max(50, { message: "validation:common.invalid_list" });

const notEmpty = (b: Record<string, unknown>) => Object.values(b).some((v) => v !== undefined);

// ---- Thẻ ----

export const createTagSchema = z.object({ body: z.object({ name: name(100) }) });
export const updateTagSchema = z.object({ params: idParamSchema, body: z.object({ name: name(100) }) });

// ---- Món ăn ----

export const createDishSchema = z.object({
    body: z.object({
        name: name(),
        description: optionalString(2000),
        price,
        category: category.optional(),
        status: status.optional(),
        tag_ids: idList.optional(),
    }),
});

export const updateDishSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: name().optional(),
            description: optionalString(2000),
            price: price.optional(),
            category: category.optional(),
            status: status.optional(),
            tag_ids: idList.optional(),
        })
        .refine(notEmpty, { message: "validation:common.empty_update" }),
});

// ---- Combo ----

const comboItems = z
    .array(
        z.object({
            dish_id: positiveInt(),
            quantity: z.coerce
                .number({ message: "validation:menu.quantity.invalid" })
                .int({ message: "validation:menu.quantity.invalid" })
                .min(1, { message: "validation:menu.quantity.invalid" })
                .max(99, { message: "validation:menu.quantity.invalid" }),
        }),
        { message: "validation:menu.items.required" },
    )
    .min(1, { message: "validation:menu.items.required" })
    .max(50, { message: "validation:common.invalid_list" })
    .refine((items) => new Set(items.map((i) => i.dish_id)).size === items.length, {
        message: "validation:menu.items.duplicate",
    });

export const createComboSchema = z.object({
    body: z.object({
        name: name(),
        description: optionalString(2000),
        price,
        status: status.optional(),
        items: comboItems,
    }),
});

export const updateComboSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: name().optional(),
            description: optionalString(2000),
            price: price.optional(),
            status: status.optional(),
            items: comboItems.optional(),
        })
        .refine(notEmpty, { message: "validation:common.empty_update" }),
});

// ---- Thực đơn theo nhà hàng ----

export const restaurantMenuSchema = z.object({
    params: z.object({ restaurantId: positiveInt() }),
});

export const updateRestaurantMenuItemSchema = z.object({
    params: z.object({ restaurantId: positiveInt(), itemId: positiveInt() }),
    body: z
        .object({
            is_available: optionalBoolean(),
            // null = bỏ giá riêng, dùng lại giá gốc
            price: z.preprocess((v) => (v === "" ? null : v), price.nullable().optional()),
        })
        .refine(notEmpty, { message: "validation:common.empty_update" }),
});

// ---- Hình ảnh ----

const entity = {
    entity_type: z.enum(ImageEntityEnum, { message: "validation:image.entity_type.invalid" }),
    entity_id: positiveInt(),
};

export const getImagesSchema = z.object({ query: z.object(entity) });
export const uploadImagesSchema = z.object({ body: z.object(entity) });
export const imageIdSchema = z.object({ params: idParamSchema });
/** PUT /images/order: thứ tự mới của toàn bộ ảnh của đối tượng */
export const reorderImagesSchema = z.object({
    body: z.object({
        ...entity,
        image_ids: z
            .array(positiveInt(), { message: "validation:common.invalid_list" })
            .min(1, { message: "validation:common.invalid_list" })
            .max(100, { message: "validation:common.invalid_list" })
            .refine((ids) => new Set(ids).size === ids.length, { message: "validation:common.invalid_list" }),
    }),
});
