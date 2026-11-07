import { z } from "zod";

/** Chuỗi rỗng (thường gặp ở multipart/form-data) -> undefined */
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
/** Chuỗi rỗng -> null (để xóa giá trị) */
const blankToNull = (v: unknown) => (v === "" ? null : v);

export const optionalString = (max = 255, message = "validation:common.too_long") =>
    z.preprocess(blankToNull, z.string().trim().max(max, { message }).nullable().optional());

export const optionalPositiveInt = (message = "validation:common.invalid_id") =>
    z.preprocess(blankToUndefined, z.coerce.number().int({ message }).positive({ message }).optional());

export const positiveInt = (message = "validation:common.invalid_id") =>
    z.coerce.number({ message }).int({ message }).positive({ message });

export const optionalBoolean = () =>
    z.preprocess((v) => {
        if (v === "" || v === undefined) return undefined;
        if (v === "true" || v === true) return true;
        if (v === "false" || v === false) return false;
        return v;
    }, z.boolean({ message: "validation:common.invalid_boolean" }).optional());

/** Nhận mảng, chuỗi đơn, hoặc chuỗi "a,b" -> mảng chuỗi */
export const stringArray = () =>
    z.preprocess(
        (v) => {
            if (v === undefined) return undefined;
            if (Array.isArray(v)) return v;
            if (typeof v === "string") return v === "" ? [] : v.split(",").map((s) => s.trim());
            return v;
        },
        z.array(z.string({ message: "validation:common.invalid_list" }), { message: "validation:common.invalid_list" }),
    );

export const idParamSchema = z.object({ id: positiveInt() });
