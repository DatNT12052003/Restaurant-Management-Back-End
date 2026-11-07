import { z } from "zod";
import { GenderEnum, GuestStatusEnum, UserStatusEnum } from "~/common/enum";
import { idParamSchema, optionalPositiveInt, optionalString, stringArray } from "./common.schema";

export const createUserSchema = z.object({
    body: z.object({
        full_name: z
            .string()
            .min(1, { message: "validation:user.full_name.required" })
            .refine(
                (val) => {
                    const words = val.trim().split(/\s+/);
                    return words.length >= 2;
                },
                {
                    message: "validation:user.full_name.invalid",
                },
            ),
    }),
});

export const createUserWithAccountSchema = z.object({
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
        user: z.object({
            full_name: z
                .string()
                .min(1, { message: "validation:user.full_name.required" })
                .refine(
                    (val) => {
                        const words = val.trim().split(/\s+/);
                        return words.length >= 2;
                    },
                    {
                        message: "validation:user.full_name.invalid",
                    },
                ),
            email: z
                .string()
                .optional()
                .nullable()
                .refine(
                    (val) => {
                        if (!val) return true;
                        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
                    },
                    {
                        message: "validation:user.email.invalid",
                    },
                ),
        }),
    }),
});

export type CreateUserWithAccountInput = z.infer<typeof createUserWithAccountSchema>["body"];

// ---------------------------------------------------------------------------
// Nhân viên / khách / hồ sơ cá nhân (giai đoạn 1)
// Hỗ trợ cả JSON và multipart/form-data (mọi giá trị đều là chuỗi).
// ---------------------------------------------------------------------------

const blankToNull = (v: unknown) => (v === "" ? null : v);

const fullName = z
    .string({ message: "validation:user.full_name.required" })
    .trim()
    .min(1, { message: "validation:user.full_name.required" })
    .max(255, { message: "validation:common.too_long" });

const profileFields = {
    date_of_birth: z.preprocess(
        blankToNull,
        z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "validation:user.date_of_birth.invalid" })
            .nullable()
            .optional(),
    ),
    gender: z.preprocess(blankToNull, z.enum(GenderEnum, { message: "validation:user.gender.invalid" }).nullable().optional()),
    address: optionalString(1000),
    email: z.preprocess(
        blankToNull,
        z.string().trim().email({ message: "validation:user.email.invalid" }).nullable().optional(),
    ),
    phone_number: z.preprocess(
        blankToNull,
        z
            .string()
            .trim()
            .regex(/^\+?[0-9\s-]{8,15}$/, { message: "validation:user.phone_number.invalid" })
            .nullable()
            .optional(),
    ),
};

const employeeFields = {
    status: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.enum(UserStatusEnum, { message: "validation:user.status.invalid" }).optional(),
    ),
    restaurant_id: optionalPositiveInt(),
    salary: z.preprocess(
        blankToNull,
        z.coerce.number({ message: "validation:user.salary.invalid" }).min(0, { message: "validation:user.salary.invalid" }).nullable().optional(),
    ),
};

const guestFields = {
    guest_status: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.enum(GuestStatusEnum, { message: "validation:user.guest_status.invalid" }).optional(),
    ),
};

const newAccount = z.object(
    {
        username: z
            .string({ message: "validation:account.username.required" })
            .trim()
            .min(1, { message: "validation:account.username.required" })
            .min(5, { message: "validation:account.username.invalid" }),
        password: z
            .string({ message: "validation:account.password.required" })
            .min(1, { message: "validation:account.password.required" })
            .min(6, { message: "validation:account.password.invalid" }),
    },
    { message: "validation:account.required" },
);

const updateAccount = z
    .object({
        username: z.preprocess(
            (v) => (v === "" ? undefined : v),
            z.string().trim().min(5, { message: "validation:account.username.invalid" }).optional(),
        ),
    })
    .optional();

const roles = stringArray().pipe(z.array(z.string()).min(1, { message: "validation:user.roles.required" }));

export const createEmployeeSchema = z.object({
    body: z.object({
        user: z.object({ full_name: fullName, ...profileFields, ...employeeFields }, { message: "validation:user.required" }),
        account: newAccount,
        roles,
    }),
});

export const updateEmployeeSchema = z.object({
    params: idParamSchema,
    body: z.object({
        user: z.object({ full_name: fullName.optional(), ...profileFields, ...employeeFields }).optional(),
        account: updateAccount,
        roles: roles.optional(),
    }),
});

export const createGuestSchema = z.object({
    body: z.object({
        user: z.object({ full_name: fullName, ...profileFields, ...guestFields }, { message: "validation:user.required" }),
        account: newAccount,
    }),
});

export const updateGuestSchema = z.object({
    params: idParamSchema,
    body: z.object({
        user: z.object({ full_name: fullName.optional(), ...profileFields, ...guestFields }).optional(),
        account: updateAccount,
    }),
});

/** PATCH /users/:id: chỉ thông tin cá nhân */
export const updateProfileSchema = z.object({
    params: idParamSchema,
    body: z.object({ full_name: fullName.optional(), ...profileFields }),
});
