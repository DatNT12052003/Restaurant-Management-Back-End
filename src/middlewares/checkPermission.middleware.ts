import { Request, Response, NextFunction } from "express";
import { RolesEnum } from "~/common/enum";
import { authenticationErrorResponse, authorizationErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getPermissionsByUserId } from "~/repositories/permission.repository";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserByAccountId } from "~/repositories/user.repository";

export const checkPermission = (requiredPermission: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const accountId = req.account?.account_id;

            if (!accountId) {
                authenticationErrorResponse(res, req.t("common:authentication_required"));
                return;
            }

            const user = await getUserByAccountId(accountId);
            const userPermissions = await getPermissionsByUserId(user.id);
            const hasPermission = userPermissions.includes(requiredPermission);

            if (!hasPermission) {
                authorizationErrorResponse(res, req.t("common:forbidden"));
                return;
            }

            req.user = user;
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

    const roles = await getRolesByUserId(user.id);
    if (roles.includes(RolesEnum.ADMIN) || roles.includes(RolesEnum.MANAGER)) {
        return next();
    } else {
        authorizationErrorResponse(res, req.t("common:forbidden"));
        return;
    }
};
