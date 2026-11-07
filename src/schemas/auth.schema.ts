import { z } from "zod";

export const loginSchema = z.object({
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

export type LoginInput = z.infer<typeof loginSchema>["body"];

export const changePasswordSchema = z.object({
    body: z
        .object({
            current_password: z
                .string({ message: "validation:account.password.required" })
                .min(1, { message: "validation:account.password.required" }),
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
