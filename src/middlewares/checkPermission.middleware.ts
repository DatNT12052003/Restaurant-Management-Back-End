import { Request, Response, NextFunction } from "express";
import { RolesEnum } from "~/common/enum";
import { authenticationErrorResponse, authorizationErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getPermissionsByUserId } from "~/repositories/permission.repository";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserByAccountId } from "~/repositories/user.repository";

/**
 * Yêu cầu chạy sau `authMiddleware`.
 * Kiểm tra user có permission `requiredPermission` (gộp từ role + quyền cấp trực tiếp),
 * đồng thời gán `req.user` và `req.roles` cho các middleware/controller phía sau.
 */
export const checkPermission = (requiredPermission: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const accountId = req.account?.account_id;

            if (!accountId) {
                authenticationErrorResponse(res, req.t("common:authentication_required"));
                return;
            }

            const user = await getUserByAccountId(accountId);
            if (!user) {
                authenticationErrorResponse(res, req.t("common:authentication_required"));
                return;
            }

            const [userPermissions, roles] = await Promise.all([
                getPermissionsByUserId(user.id),
                getRolesByUserId(user.id),
            ]);

            if (!userPermissions.includes(requiredPermission)) {
                authorizationErrorResponse(res, req.t("common:forbidden"));
                return;
            }

            req.user = user;
            req.roles = roles;
            next();
        } catch (error) {
            serverErrorResponse(res);
            return;
        }
    };
};

export const isSelfOrAdminOrManager = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const accountId = req.account?.account_id;
    const user = req.user;
    const targetUserId = Number(req.params.id);

    if (!accountId) {
        authenticationErrorResponse(res, req.t("common:authentication_required"));
        return;
    }

    if (!user) {
        serverErrorResponse(res);
        return;
    }

    if (user.id === targetUserId) {
        return next();
    }

    try {
        const roles = req.roles ?? (await getRolesByUserId(user.id));
        if (roles.includes(RolesEnum.ADMIN) || roles.includes(RolesEnum.MANAGER)) {
            return next();
        }
        authorizationErrorResponse(res, req.t("common:forbidden"));
    } catch (error) {
        serverErrorResponse(res);
    }
};
