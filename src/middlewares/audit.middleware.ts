import { NextFunction, Request, Response } from "express";
import logger from "~/config/logger";
import { auditContext, diffChanges, sanitize, writeAuditSafe } from "~/utils/audit";

type Data = Record<string, any> | null | undefined;

export interface IAuditRouteOptions {
    /** Đọc bản ghi trước khi thay đổi (chạy trước controller). Có `before` thì chỉ ghi các trường thay đổi. */
    before?: (req: Request) => Promise<unknown>;
    /** Mặc định: `req.params.id`, nếu không có thì `data.id` */
    entityId?: (req: Request, data: Data) => unknown;
    /** Mặc định: `restaurant_id` của dữ liệu trả về / bản ghi cũ / phạm vi người thao tác / request */
    restaurantId?: (req: Request, data: Data, before: Data) => unknown;
    /** Thao tác xóa: chỉ ghi `before` */
    isDelete?: boolean;
}

const toId = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Ghi audit log cho các thao tác CRUD thông thường, đặt ngay trước controller (sau kiểm tra quyền và validate).
 * Chỉ ghi khi response thành công (`success: true`, status < 400), sau khi response đã gửi, ngoài transaction.
 *
 * Thao tác nhạy cảm (phân quyền, hoàn tiền, kho, hủy order, đăng nhập) ghi trong service, cùng transaction.
 */
export const auditRoute =
    (action: string, entityType: string, options: IAuditRouteOptions = {}) =>
    async (req: Request, res: Response, next: NextFunction) => {
        let before: Data;
        if (options.before) {
            try {
                before = (await options.before(req)) as Data;
            } catch (error) {
                logger.warn(`Audit: load before failed for ${action}`, { error: (error as Error).message });
            }
        }

        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
            if (res.statusCode < 400 && body?.success) {
                const data: Data = body.data;
                const entityId = toId(options.entityId ? options.entityId(req, data) : (req.params?.id ?? data?.id));
                const restaurantId = toId(
                    options.restaurantId
                        ? options.restaurantId(req, data, before)
                        : (data?.restaurant_id ??
                              before?.restaurant_id ??
                              req.restaurantScope ??
                              req.params?.restaurantId ??
                              req.body?.restaurant_id),
                );
                let entry: { before?: unknown; after?: unknown };
                if (options.isDelete) entry = { before: sanitize(before ?? null) };
                else if (before) entry = diffChanges(before, data);
                else entry = { after: sanitize(data) };

                void writeAuditSafe(auditContext(req), {
                    action,
                    entity_type: entityType,
                    entity_id: entityId,
                    restaurant_id: restaurantId,
                    ...entry,
                });
            }
            return originalJson(body);
        };
        next();
    };
