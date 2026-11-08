import { z } from "zod";
import { KitchenStationEnum, OrderItemStatusEnum } from "~/common/enum";
import { idParamSchema, optionalPositiveInt, optionalString, positiveInt } from "./common.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);

const guestCount = z.coerce
    .number({ message: "validation:reservation.guest_count.invalid" })
    .int({ message: "validation:reservation.guest_count.invalid" })
    .min(1, { message: "validation:reservation.guest_count.invalid" })
    .max(500, { message: "validation:reservation.guest_count.invalid" });

const quantity = z.coerce
    .number({ message: "validation:menu.quantity.invalid" })
    .int({ message: "validation:menu.quantity.invalid" })
    .min(1, { message: "validation:menu.quantity.invalid" })
    .max(99, { message: "validation:menu.quantity.invalid" });

const tableIds = z
    .array(positiveInt(), { message: "validation:reservation.tables.required" })
    .min(1, { message: "validation:reservation.tables.required" })
    .max(20, { message: "validation:common.invalid_list" })
    .refine((ids) => new Set(ids).size === ids.length, { message: "validation:reservation.tables.duplicate" });

const nullableId = z.preprocess(blankToNull, positiveInt().nullable().optional());

export const createOrderSchema = z.object({
    body: z
        .object({
            restaurant_id: optionalPositiveInt(),
            // Mở order từ reservation: bàn, số khách, khách lấy theo reservation nếu không gửi
            reservation_id: optionalPositiveInt(),
            table_ids: tableIds.optional(),
            guest_count: guestCount.optional(),
            guest_user_id: nullableId,
            assigned_staff_id: nullableId,
            note: optionalString(2000),
        })
        .refine((b) => b.reservation_id || (b.table_ids && b.guest_count), {
            message: "validation:order.tables_and_guests_required",
            path: ["table_ids"],
        }),
});

export const updateOrderSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            guest_count: guestCount.optional(),
            guest_user_id: nullableId,
            assigned_staff_id: nullableId,
            note: optionalString(2000),
        })
        .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "validation:common.empty_update" }),
});

export const orderIdSchema = z.object({ params: idParamSchema });

export const cancelOrderSchema = z.object({
    params: idParamSchema,
    body: z.object({ cancel_reason: optionalString(1000) }),
});

const line = { quantity, note: optionalString(500) };

export const createRoundSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            table_id: optionalPositiveInt(),
            note: optionalString(1000),
            items: z
                .array(z.object({ dish_id: positiveInt(), ...line }), { message: "validation:common.invalid_list" })
                .max(50, { message: "validation:common.invalid_list" })
                .optional(),
            combos: z
                .array(z.object({ combo_id: positiveInt(), ...line }), { message: "validation:common.invalid_list" })
                .max(50, { message: "validation:common.invalid_list" })
                .optional(),
        })
        .refine((b) => (b.items?.length ?? 0) + (b.combos?.length ?? 0) > 0, {
            message: "validation:order.items_required",
            path: ["items"],
        }),
});

export const addOrderTablesSchema = z.object({
    params: idParamSchema,
    body: z.object({ table_ids: tableIds }),
});

export const transferOrderTableSchema = z.object({
    params: idParamSchema,
    body: z
        .object({ from_table_id: positiveInt(), to_table_id: positiveInt() })
        .refine((b) => b.from_table_id !== b.to_table_id, {
            message: "validation:order.same_table",
            path: ["to_table_id"],
        }),
});

export const releaseOrderTableSchema = z.object({
    params: z.object({ id: positiveInt(), tableId: positiveInt() }),
});

export const updateLineStatusSchema = z.object({
    params: idParamSchema,
    body: z.object({
        status: z.enum(OrderItemStatusEnum, { message: "validation:order.item_status_invalid" }),
        cancel_reason: optionalString(500),
    }),
});

const lineKind = z.enum(["dish", "combo"], { message: "validation:order.line_kind_invalid" });

/** Không trùng dòng (cùng loại, cùng id) */
const uniqueLines = (lines: { kind: string; id: number }[]) =>
    new Set(lines.map((l) => `${l.kind}:${l.id}`)).size === lines.length;

/** PATCH /orders/lines/status: đổi trạng thái nhiều dòng (`lines`) hoặc cả một đợt gọi món (`round_id`) */
export const batchLineStatusSchema = z.object({
    body: z
        .object({
            status: z.enum(OrderItemStatusEnum, { message: "validation:order.item_status_invalid" }),
            cancel_reason: optionalString(500),
            lines: z
                .array(z.object({ kind: lineKind, id: positiveInt() }), { message: "validation:common.invalid_list" })
                .min(1, { message: "validation:common.invalid_list" })
                .max(200, { message: "validation:common.invalid_list" })
                .refine(uniqueLines, { message: "validation:order.duplicate_lines" })
                .optional(),
            round_id: optionalPositiveInt(),
            station: z.preprocess(
                blankToUndefined,
                z.enum(KitchenStationEnum, { message: "validation:order.station_invalid" }).optional(),
            ),
        })
        .refine((b) => !!b.lines !== !!b.round_id, { message: "validation:order.lines_or_round", path: ["lines"] }),
});

export const mergeOrderSchema = z.object({
    params: idParamSchema,
    body: z.object({ target_order_id: positiveInt() }),
});

/** POST /orders/:id/split: tách món sang order có sẵn (`target_order_id`) hoặc order mới trên `table_ids` */
export const splitOrderSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            lines: z
                .array(z.object({ kind: lineKind, id: positiveInt(), quantity }), { message: "validation:order.split_lines_required" })
                .min(1, { message: "validation:order.split_lines_required" })
                .max(100, { message: "validation:common.invalid_list" })
                .refine(uniqueLines, { message: "validation:order.duplicate_lines" }),
            target_order_id: optionalPositiveInt(),
            table_ids: tableIds.optional(),
            guest_count: guestCount.optional(),
            note: optionalString(2000),
        })
        .refine((b) => !!b.target_order_id !== !!b.table_ids, {
            message: "validation:order.split_target_required",
            path: ["target_order_id"],
        }),
});

const dateTime = z.coerce.date({ message: "validation:reservation.time.invalid" });

/** GET /orders: tham số riêng ngoài bộ lọc chung */
export const listOrdersSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        table_id: optionalPositiveInt(),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});

export const activeOrdersSchema = z.object({
    query: z.object({ restaurant_id: optionalPositiveInt() }),
});

export const kitchenQueueSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        station: z.preprocess(
            blankToUndefined,
            z.enum(KitchenStationEnum, { message: "validation:order.station_invalid" }).optional(),
        ),
    }),
});
