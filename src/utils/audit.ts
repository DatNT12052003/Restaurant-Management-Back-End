import { Request } from "express";
import { db } from "~/config/db";
import { IAuditContext } from "~/interfaces";

/** Ngữ cảnh audit từ request (người thao tác, IP, trình duyệt) */
export const auditContext = (req: Request): IAuditContext => ({
    accountId: req.account?.account_id ?? null,
    userId: req.user?.id ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
});

/**
 * Ghi một dòng nhật ký thao tác (đặc tả 4.11). Gọi TRONG transaction của thao tác để hai việc cùng thành công
 * hoặc cùng bị hủy. API không có đường sửa / xóa audit log.
 */
export const writeAudit = async (
    ctx: IAuditContext,
    entry: {
        action: string;
        entity_type: string;
        entity_id?: number | null;
        restaurant_id?: number | null;
        before?: unknown;
        after?: unknown;
    },
): Promise<void> => {
    await db().query(
        `INSERT INTO audit_logs (account_id, user_id, restaurant_id, action, entity_type, entity_id, before, after, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            ctx.accountId ?? null,
            ctx.userId ?? null,
            entry.restaurant_id ?? null,
            entry.action,
            entry.entity_type,
            entry.entity_id ?? null,
            entry.before === undefined ? null : JSON.stringify(entry.before),
            entry.after === undefined ? null : JSON.stringify(entry.after),
            ctx.ip ?? null,
            ctx.userAgent ?? null,
        ],
    );
};
