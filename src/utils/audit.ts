import { Request } from "express";
import { db } from "~/config/db";
import logger from "~/config/logger";
import { IAuditContext, IAuditEntry } from "~/interfaces";

/** Tên hành động audit log dùng ở nhiều nơi (các hành động CRUD đặt tên `<đối tượng>.<create|update|delete>`) */
export const AUDIT_ACTION = {
    LOGIN: "auth.login",
    LOGIN_FAILED: "auth.login_failed",
    ACCOUNT_LOCKED: "auth.account_locked",
    ACCOUNT_UNLOCKED: "account.unlock",
    ACCOUNT_LOGOUT_ALL: "account.logout_all",
    ACCOUNT_RESET_PASSWORD: "account.reset_password",
    AUDIT_ARCHIVE: "audit.archive",
    LOGOUT: "auth.logout",
    LOGOUT_ALL: "auth.logout_all",
    CHANGE_PASSWORD: "auth.change_password",
    RESET_PASSWORD: "auth.reset_password",
    ROLE_PERMISSIONS: "role.permissions_update",
    USER_PERMISSIONS: "user.permissions_update",
    ORDER_CANCEL: "order.cancel",
    ORDER_ITEM_CANCEL: "order_item.cancel",
    PAYMENT_REFUND: "payment.refund",
} as const;

/** Ngữ cảnh audit từ request (người thao tác, IP, trình duyệt) */
export const auditContext = (req: Request): IAuditContext => ({
    accountId: req.account?.account_id ?? null,
    userId: req.user?.id ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
});

/** Khóa không bao giờ được ghi vào nhật ký */
const SECRET_KEYS = new Set([
    "password",
    "hash_password",
    "current_password",
    "new_password",
    "confirm_password",
    "token",
    "hash_token",
    "access_token",
    "refresh_token",
    "reset_password_token",
]);

/** Khóa thay đổi theo mọi lần cập nhật, không có ý nghĩa khi so sánh */
const NOISE_KEYS = new Set(["updated_at", "total_count"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Bỏ các trường bí mật (đệ quy) và chuẩn hóa về dạng JSON */
export const sanitize = (value: unknown): unknown => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value.map(sanitize);
    if (value instanceof Date) return value.toISOString();
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (SECRET_KEYS.has(k) || v === undefined) continue;
            out[k] = sanitize(v);
        }
        return out;
    }
    return value;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Chỉ giữ các trường thay đổi giữa `before` và `after` (so sánh đệ quy với object, cả mảng với mảng).
 * Trường chỉ có ở `after` được coi là thay đổi; trường chỉ có ở `before` bị bỏ qua (response thường gọn hơn bản ghi).
 */
export const diffChanges = (before: unknown, after: unknown): { before: unknown; after: unknown } => {
    const b = sanitize(before);
    const a = sanitize(after);
    if (!isPlainObject(b) || !isPlainObject(a)) return { before: b, after: a };
    const outBefore: Record<string, unknown> = {};
    const outAfter: Record<string, unknown> = {};
    for (const key of Object.keys(a)) {
        if (NOISE_KEYS.has(key)) continue;
        if (isPlainObject(a[key]) && isPlainObject(b[key])) {
            const nested = diffChanges(b[key], a[key]);
            if (Object.keys(nested.after as object).length) {
                outBefore[key] = nested.before;
                outAfter[key] = nested.after;
            }
        } else if (!same(a[key], b[key] ?? null)) {
            outBefore[key] = b[key] ?? null;
            outAfter[key] = a[key];
        }
    }
    return { before: outBefore, after: outAfter };
};

/**
 * Ghi một dòng nhật ký thao tác (đặc tả 4.11). Gọi TRONG transaction của thao tác để hai việc cùng thành công
 * hoặc cùng bị hủy. API không có đường sửa / xóa audit log; DB có trigger chặn UPDATE / DELETE.
 *
 * `user_id` tự tìm theo `account_id` nếu thiếu; `actor_name` chụp lại họ tên (hoặc username) lúc ghi.
 * `entry.restaurant_id` bỏ trống (undefined) thì lấy nhà hàng của người thao tác; truyền `null` để không gắn nhà hàng.
 */
export const writeAudit = async (ctx: IAuditContext, entry: IAuditEntry): Promise<void> => {
    const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(sanitize(v)));
    await db().query(
        `WITH actor AS (
            SELECT COALESCE($2::int, (SELECT u.id FROM users u WHERE u.account_id = $1::int ORDER BY u.id LIMIT 1)) AS user_id
        )
        INSERT INTO audit_logs
            (account_id, user_id, restaurant_id, action, entity_type, entity_id, before, after, ip, user_agent, actor_name)
        SELECT $1::int, a.user_id,
            CASE WHEN $12::boolean THEN (SELECT u.restaurant_id FROM users u WHERE u.id = a.user_id) ELSE $3::int END,
            $4, $5, $6::int, $7::jsonb, $8::jsonb, $9, $10,
            LEFT(COALESCE(
                (SELECT u.full_name FROM users u WHERE u.id = a.user_id),
                (SELECT ac.username FROM accounts ac WHERE ac.id = $1::int),
                $11
            ), 255)
        FROM actor a`,
        [
            ctx.accountId ?? null,
            ctx.userId ?? null,
            entry.restaurant_id ?? null,
            entry.action,
            entry.entity_type,
            entry.entity_id ?? null,
            json(entry.before),
            json(entry.after),
            ctx.ip ?? null,
            ctx.userAgent ?? null,
            entry.actor_name ?? null,
            entry.restaurant_id === undefined,
        ],
    );
};

/**
 * Ghi nhật ký ngoài transaction (ví dụ đăng nhập thất bại, hoặc sau khi response đã gửi).
 * Lỗi ghi nhật ký chỉ được log lại, không làm hỏng thao tác chính.
 */
export const writeAuditSafe = async (ctx: IAuditContext, entry: IAuditEntry): Promise<void> => {
    try {
        await writeAudit(ctx, entry);
    } catch (error) {
        logger.error(`Write audit log failed: ${entry.action}`, { error: (error as Error).message });
    }
};
