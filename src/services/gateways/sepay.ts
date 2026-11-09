import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { INormalizedTransfer } from "~/interfaces";

/**
 * Giai đoạn 14: SePay báo biến động số dư tài khoản ngân hàng qua webhook.
 * - Xác thực: SePay gửi header `Authorization: Apikey <SEPAY_WEBHOOK_API_KEY>` (cấu hình "API Key" ở trang webhook SePay).
 * - Phản hồi `{ success: true }` với HTTP 200 để SePay không gửi lại; gửi lại vẫn an toàn nhờ khóa (provider, id).
 * Tài liệu: https://docs.sepay.vn/tich-hop-webhooks.html
 */
export const SEPAY = "sepay";

/** Webhook bị tắt khi chưa đặt khóa */
export const isConfigured = () => Boolean(process.env.SEPAY_WEBHOOK_API_KEY);

export const verify = (authorization: string | undefined): boolean => {
    const key = process.env.SEPAY_WEBHOOK_API_KEY;
    if (!key || !authorization) return false;
    const match = /^apikey\s+(.+)$/i.exec(authorization.trim());
    if (!match) return false;
    const given = Buffer.from(match[1].trim());
    const expected = Buffer.from(key);
    return given.length === expected.length && timingSafeEqual(given, expected);
};

const nullableText = z.preprocess((v) => (v === undefined || v === "" ? null : v), z.string().nullable());

const payloadSchema = z.object({
    id: z.union([z.number(), z.string().min(1)]),
    gateway: nullableText.optional(),
    transactionDate: nullableText.optional(),
    accountNumber: z.preprocess((v) => (v === null || v === undefined ? null : String(v)), z.string().nullable()),
    code: nullableText.optional(),
    content: nullableText.optional(),
    transferType: z.enum(["in", "out"]),
    transferAmount: z.coerce.number().positive(),
    referenceCode: nullableText.optional(),
    description: nullableText.optional(),
});

/** `transactionDate` của SePay là giờ Việt Nam, dạng "YYYY-MM-DD HH:mm:ss" */
const parseVnTime = (value: string | null | undefined): Date | null => {
    if (!value) return null;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(value.trim());
    const date = m ? new Date(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+07:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** Chuẩn hóa payload; sai định dạng thì trả về null */
export const parse = (body: unknown): INormalizedTransfer | null => {
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) return null;
    const b = parsed.data;
    return {
        provider: SEPAY,
        provider_txn_id: String(b.id),
        direction: b.transferType,
        account_number: b.accountNumber,
        amount: b.transferAmount,
        content: [b.content, b.description].filter(Boolean).join(" | ") || null,
        bank_reference: b.referenceCode ?? null,
        code: b.code ?? null,
        transaction_at: parseVnTime(b.transactionDate),
        raw: body,
    };
};
