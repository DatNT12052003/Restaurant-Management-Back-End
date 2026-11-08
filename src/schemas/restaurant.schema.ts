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

export const createRestaurantSchema = z.object({
    body: z.object({
        name,
        address,
        status: status.optional(),
        service_fee_percent: percent.optional(),
        tax_percent: percent.optional(),
        open_time: time.optional(),
        close_time: time.optional(),
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
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const restaurantIdSchema = z.object({ params: idParamSchema });
