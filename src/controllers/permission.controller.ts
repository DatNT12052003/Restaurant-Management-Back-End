import { Request, Response } from "express";
import { PERMISSION_ERROR } from "~/common/error-code/permission";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { getSuccessResponse, successResponse } from "~/common/responses/success";
import { permissionService } from "~/services";

const actorOf = (req: Request) => ({ roles: req.roles || [], permissions: req.permissions || [] });

const respondPermissionError = (req: Request, res: Response, code: number) => {
    switch (code) {
        case PERMISSION_ERROR.ROLE_NOT_FOUND:
            return notFoundResponse(res, req.t("permission:role_not_found"));
        case PERMISSION_ERROR.ADMIN_ROLE_LOCKED:
            return authorizationErrorResponse(res, req.t("permission:admin_role_locked"));
        case PERMISSION_ERROR.ROLE_NOT_MANAGEABLE:
            return authorizationErrorResponse(res, req.t("permission:role_not_manageable"));
        case PERMISSION_ERROR.PERMISSION_NOT_GRANTABLE:
            return authorizationErrorResponse(res, req.t("permission:permission_not_grantable"));
        case PERMISSION_ERROR.INVALID_PERMISSIONS:
            return badRequestResponse(res, req.t("permission:invalid_permissions"));
        default:
            return createErrorResponse(res, req.t("permission:update_failed"));
    }
};

export const getPermissions = async (req: Request, res: Response) => {
    try {
        const permissions = await permissionService.getPermissions();
        if (typeof permissions === "number") {
            return createErrorResponse(res, req.t("permission:get_failed"));
        }
        return getSuccessResponse(res, req.t("permission:get_permissions_successfully"), permissions);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getRoles = async (req: Request, res: Response) => {
    try {
        const roles = await permissionService.getRoles(actorOf(req));
        if (typeof roles === "number") {
            return createErrorResponse(res, req.t("permission:get_failed"));
        }
        return getSuccessResponse(res, req.t("permission:get_roles_successfully"), roles);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateRolePermissions = async (req: Request, res: Response) => {
    try {
        const result = await permissionService.updateRolePermissions(
            Number(req.params.id),
            req.body.permissions,
            actorOf(req),
        );
        if (typeof result === "number") {
            return respondPermissionError(req, res, result);
        }
        return successResponse(res, req.t("permission:update_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getUserPermissions = async (req: Request, res: Response) => {
    try {
        const result = await permissionService.getUserPermissions(Number(req.params.id));
        if (typeof result === "number") {
            return createErrorResponse(res, req.t("permission:get_failed"));
        }
        return getSuccessResponse(res, req.t("permission:get_permissions_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateUserPermissions = async (req: Request, res: Response) => {
    try {
        const result = await permissionService.updateUserPermissions(
            Number(req.params.id),
            req.body.permissions,
            actorOf(req),
        );
        if (typeof result === "number") {
            return respondPermissionError(req, res, result);
        }
        return successResponse(res, req.t("permission:update_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
