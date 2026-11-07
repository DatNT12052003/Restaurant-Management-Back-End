import { Request, Response, NextFunction } from "express";
import { UserStatusEnum } from "~/common/enum";
import { isAdmin, outranks } from "~/common/role-level";
import { authenticationErrorResponse, authorizationErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getPermissionsByUserId } from "~/repositories/permission.repository";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserByAccountId, getUserById } from "~/repositories/user.repository";

/**
 * Nạp user hiện tại (từ `req.account` do `authMiddleware` gán) cùng roles và permissions.
 * Trả về false (và đã gửi response lỗi) nếu không hợp lệ.
 */
const loadContext = async (req: Request, res: Response): Promise<boolean> => {
    if (req.user && req.roles && req.permissions) return true;

    const accountId = req.account?.account_id;
    if (!accountId) {
        authenticationErrorResponse(res, req.t("common:authentication_required"));
        return false;
    }

    const user = await getUserByAccountId(accountId);
    // Nhân viên đã nghỉ (inactive) không được dùng hệ thống nữa
    if (!user || user.status === UserStatusEnum.INACTIVE) {
        authenticationErrorResponse(res, req.t("common:authentication_required"));
        return false;
    }

    const [permissions, roles] = await Promise.all([getPermissionsByUserId(user.id), getRolesByUserId(user.id)]);
    req.user = user;
    req.roles = roles;
    req.permissions = permissions;
    return true;
};

/** Chỉ nạp `req.user`, `req.roles`, `req.permissions` (không yêu cầu permission cụ thể). Chạy sau `authMiddleware`. */
export const loadUserContext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        if (await loadContext(req, res)) next();
    } catch (error) {
        serverErrorResponse(res);
    }
};

/**
 * Yêu cầu chạy sau `authMiddleware`.
 * Kiểm tra user có permission `requiredPermission` (gộp từ role + quyền cấp trực tiếp),
 * đồng thời gán `req.user`, `req.roles`, `req.permissions` cho các middleware/controller phía sau.
 */
export const checkPermission = (requiredPermission: string) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!(await loadContext(req, res))) return;

            if (!req.permissions!.includes(requiredPermission)) {
                authorizationErrorResponse(res, req.t("common:forbidden"));
                return;
            }
            next();
        } catch (error) {
            serverErrorResponse(res);
        }
    };
};

/** Như `checkPermission` nhưng chỉ cần có MỘT trong các quyền. */
export const checkAnyPermission = (requiredPermissions: string[]) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!(await loadContext(req, res))) return;
            if (!requiredPermissions.some((p) => req.permissions!.includes(p))) {
                authorizationErrorResponse(res, req.t("common:forbidden"));
                return;
            }
            next();
        } catch (error) {
            serverErrorResponse(res);
        }
    };
};

/**
 * Cho phép thao tác trên chính mình, hoặc trên người có cấp thấp hơn (cùng nhà hàng nếu không phải admin).
 * Dùng cho các route `/:id`. Phải chạy sau `checkPermission`.
 */
export const isSelfOrAdminOrManager = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actor = req.user;
    const actorRoles = req.roles;
    const targetUserId = Number(req.params.id);

    if (!actor || !actorRoles) {
        serverErrorResponse(res);
        return;
    }

    if (actor.id === targetUserId) {
        return next();
    }

    try {
        const target = await getUserById(targetUserId);
        if (!target) {
            authorizationErrorResponse(res, req.t("common:forbidden"));
            return;
        }
        const targetRoles = await getRolesByUserId(targetUserId);
        const sameRestaurant = isAdmin(actorRoles) || target.restaurant_id === actor.restaurant_id;
        if (outranks(actorRoles, targetRoles) && sameRestaurant) {
            return next();
        }
        authorizationErrorResponse(res, req.t("common:forbidden"));
    } catch (error) {
        serverErrorResponse(res);
    }
};
