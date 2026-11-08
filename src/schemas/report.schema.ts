import { z } from "zod";
import { DishCategoryEnum } from "~/common/enum";
import { idParamSchema, optionalPositiveInt } from "./common.schema";

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Số ngày tối đa của một khoảng báo cáo */
export const MAX_REPORT_DAYS = 366;

const date = z.preprocess(
    blankToUndefined,
    z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "validation:report.range.invalid" })
        .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: "validation:report.range.invalid" })
        .optional(),
);

const dayNumber = (v: string) => Math.round(Date.parse(`${v}T00:00:00Z`) / 86_400_000);

const rangeQuery = z
    .object({
        restaurant_id: optionalPositiveInt(),
        from: date,
        to: date,
        group_by: z.preprocess(
            blankToUndefined,
            z.enum(["day", "week", "month"], { message: "validation:report.group_by.invalid" }).optional(),
        ),
        limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(50).optional()),
        category: z.preprocess(blankToUndefined, z.enum(DishCategoryEnum).optional()),
    })
    .refine((q) => !q.from || !q.to || (dayNumber(q.to) >= dayNumber(q.from) && dayNumber(q.to) - dayNumber(q.from) < MAX_REPORT_DAYS), {
        message: "validation:report.range.invalid",
        path: ["from"],
    });

export const reportQuerySchema = z.object({ query: rangeQuery });

// ---- Nhật ký hoạt động ----

const dateTime = z.coerce.date({ message: "validation:report.range.invalid" });

export const listAuditLogsSchema = z.object({
    query: z.object({
        restaurant_id: optionalPositiveInt(),
        action: z.preprocess(blankToUndefined, z.string().max(100).optional()),
        /** Phần đầu của action, ví dụ `auth` -> mọi hành động `auth.*` */
        module: z.preprocess(blankToUndefined, z.string().regex(/^[a-z_]{1,50}$/).optional()),
        entity_type: z.preprocess(blankToUndefined, z.string().max(50).optional()),
        entity_id: optionalPositiveInt(),
        user_id: optionalPositiveInt(),
        from: z.preprocess(blankToUndefined, dateTime.optional()),
        to: z.preprocess(blankToUndefined, dateTime.optional()),
    }),
});

export const auditLogIdSchema = z.object({ params: idParamSchema });

export const auditFacetsSchema = z.object({
    query: z.object({ restaurant_id: optionalPositiveInt() }),
});
