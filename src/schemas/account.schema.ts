import { z } from "zod";

export const createAccountSchema = z.object({
    body: z.object({
        username: z
            .string()
            .min(1, { message: "validation:account.username.required" })
            .min(5, { message: "validation:account.username.invalid" }),
        // .refine((val) => /\S+@\S+\.\S+/.test(val), {
        //     message: "validation:account.username.invalid",
        // }),

        password: z
            .string()
            .min(1, { message: "validation:account.password.required" })
            .min(6, { message: "validation:account.password.invalid" }),
    }),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>["body"];
