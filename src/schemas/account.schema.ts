import { z } from "zod";
import { idParamSchema, optionalBoolean, optionalPositiveInt } from "./common.schema";

export const createAccountSchema = z.object({
    body: z.object({
        username: z
            .string()
            .min(1, { message: "validation:account.username.required" })
            .min(5, { message: "validation:account.username.invalid" }),

        password: z
            .string()
            .min(1, { message: "validation:account.password.required" })
            .min(6, { message: "validation:account.password.invalid" }),
    }),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>["body"];

const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Trang Tài khoản: lọc nhân viên / khách, đang bị khóa, nhà hàng (admin) */
export const listAccountsSchema = z.object({
    query: z.object({
        kind: z.preprocess(blankToUndefined, z.enum(["employee", "guest"]).optional()),
        locked: optionalBoolean(),
        restaurant_id: optionalPositiveInt(),
    }),
});

export const accountUserIdSchema = z.object({ params: idParamSchema });

/** Đặt lại mật khẩu cho người dùng cấp dưới */
export const resetAccountPasswordSchema = z.object({
    params: idParamSchema,
    body: z
        .object({
            new_password: z
                .string({ message: "validation:account.password.required" })
                .min(6, { message: "validation:account.password.invalid" }),
            confirm_password: z
                .string({ message: "validation:account.password.required" })
                .min(1, { message: "validation:account.password.required" }),
        })
        .refine((b) => b.new_password === b.confirm_password, {
            message: "validation:account.password.confirm_not_match",
            path: ["confirm_password"],
        }),
});
