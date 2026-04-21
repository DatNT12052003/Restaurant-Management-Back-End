import { z } from "zod";

export const createEmployeeSchema = z.object({
    body: z.object({
        full_name: z
            .string()
            .min(1, { message: "validation:employee.full_name.required" })
            .refine(
                (val) => {
                    const words = val.trim().split(/\s+/);
                    return words.length >= 2;
                },
                {
                    message: "validation:employee.full_name.invalid",
                },
            ),
    }),
});

export const createEmployeeWithAccountSchema = z.object({
    body: z.object({
        account: z.object({
            username: z
                .string()
                .min(1, { message: "validation:account.username.required" })
                .min(5, { message: "validation:account.username.invalid" }),
            password: z
                .string()
                .min(1, { message: "validation:account.password.required" })
                .min(6, { message: "validation:account.password.invalid" }),
        }),
        employee: z.object({
            full_name: z
                .string()
                .min(1, { message: "validation:employee.full_name.required" })
                .refine(
                    (val) => {
                        const words = val.trim().split(/\s+/);
                        return words.length >= 2;
                    },
                    {
                        message: "validation:employee.full_name.invalid",
                    },
                ),
        }),
    }),
});

export type CreateEmployeeWithAccountInput = z.infer<typeof createEmployeeWithAccountSchema>["body"];
