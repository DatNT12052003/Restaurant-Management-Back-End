import { Request, Response, NextFunction } from "express";
import { RolesEnum } from "~/common/enum";
import { isAdmin, outranks } from "~/common/role-level";
import {
    authorizationErrorResponse,
    badRequestResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserById } from "~/repositories/user.repository";

interface ICanManageOptions {
    /** Cho phép thao tác trên chính mình */
    allowSelf?: boolean;
    /** Bắt buộc người bị thao tác là nhân viên (không phải guest) hoặc là khách (guest) */
    targetKind?: "employee" | "guest";
}

/**
 * Kiểm tra người dùng hiện tại có được thao tác trên user `req.params.id` không:
 * - Người bị thao tác phải tồn tại và đúng loại (`targetKind`).
 * - Người thao tác phải có cấp cao hơn (xem `role-level.ts`).
 * - Với nhân viên: phải cùng nhà hàng (trừ admin).
 * Gán `req.targetUser`, `req.targetRoles`. Phải chạy sau `checkPermission`.
 */
export const canManageTargetUser = (options: ICanManageOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const actor = req.user;
        const actorRoles = req.roles;
        if (!actor || !actorRoles) {
            serverErrorResponse(res);
            return;
        }

        const targetId = Number(req.params.id);
        if (!Number.isInteger(targetId) || targetId <= 0) {
            badRequestResponse(res, req.t("user:invalid_user_id"));
            return;
        }

        try {
            const target = await getUserById(targetId);
            if (!target) {
                notFoundResponse(res, req.t("user:user_not_found"));
                return;
            }
            const targetRoles = await getRolesByUserId(targetId);
            const isGuest = targetRoles.includes(RolesEnum.GUEST);

            if (options.targetKind === "guest" && !isGuest) {
                notFoundResponse(res, req.t("user:guest_not_found"));
                return;
            }
            if (options.targetKind === "employee" && isGuest) {
                notFoundResponse(res, req.t("user:employee_not_found"));
                return;
            }

            req.targetUser = target;
            req.targetRoles = targetRoles;

            if (options.allowSelf && actor.id === targetId) {
                return next();
            }

            if (!outranks(actorRoles, targetRoles)) {
                authorizationErrorResponse(res, req.t("user:cannot_manage_higher_role"));
                return;
            }

            if (!isGuest && !isAdmin(actorRoles) && target.restaurant_id !== actor.restaurant_id) {
                authorizationErrorResponse(res, req.t("common:restaurant_forbidden"));
                return;
            }

            next();
        } catch (error) {
            serverErrorResponse(res);
        }
    };
};
