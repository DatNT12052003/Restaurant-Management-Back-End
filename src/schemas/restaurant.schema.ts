import { z } from "zod";
import { RestaurantStatusEnum } from "~/common/enum";
import { idParamSchema } from "./common.schema";

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

export const createRestaurantSchema = z.object({
    body: z.object({ name, address, status: status.optional() }),
});

export const updateRestaurantSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ name: name.optional(), address: address.optional(), status: status.optional() })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const restaurantIdSchema = z.object({ params: idParamSchema });
