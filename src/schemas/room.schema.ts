import { z } from "zod";
import { RoomTypeEnum, UsageStatusEnum } from "~/common/enum";
import { idParamSchema, optionalBoolean, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

const name = z
    .string({ message: "validation:room.name.required" })
    .trim()
    .min(1, { message: "validation:room.name.required" })
    .max(255, { message: "validation:common.too_long" });

const type = z.enum(RoomTypeEnum, { message: "validation:room.type.invalid" });
const status = z.enum(UsageStatusEnum, { message: "validation:common.usage_status_invalid" });

export const createRoomSchema = z.object({
    body: z.object({
        name,
        type,
        description: optionalString(1000),
        status: status.optional(),
        is_active: optionalBoolean(),
        // Bắt buộc với admin; người bị giới hạn nhà hàng thì tự lấy nhà hàng của mình
        restaurant_id: optionalPositiveInt(),
    }),
});

export const updateRoomSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: name.optional(),
            type: type.optional(),
            description: optionalString(1000),
            status: status.optional(),
            is_active: optionalBoolean(),
            restaurant_id: optionalPositiveInt(),
            // Vẫn tạm khóa dù phòng còn lịch đặt bàn sắp tới (người dùng đã xác nhận cảnh báo)
            force: optionalBoolean(),
        })
        .refine((b) => Object.entries(b).some(([k, v]) => k !== "force" && v !== undefined), {
            message: "validation:common.empty_update",
        }),
});

export const roomIdSchema = z.object({ params: idParamSchema });

// ---- Bàn ----

const tableName = z
    .string({ message: "validation:table.name.required" })
    .trim()
    .min(1, { message: "validation:table.name.required" })
    .max(255, { message: "validation:common.too_long" });

const capacity = z.coerce
    .number({ message: "validation:table.capacity.invalid" })
    .int({ message: "validation:table.capacity.invalid" })
    .min(1, { message: "validation:table.capacity.invalid" })
    .max(50, { message: "validation:table.capacity.invalid" });

export const createTableSchema = z.object({
    body: z.object({
        name: tableName,
        capacity: capacity.optional(),
        status: status.optional(),
        room_id: positiveInt(),
    }),
});

export const updateTableSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            name: tableName.optional(),
            capacity: capacity.optional(),
            status: status.optional(),
            room_id: optionalPositiveInt(),
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const tableIdSchema = z.object({ params: idParamSchema });
