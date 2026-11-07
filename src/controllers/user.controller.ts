import { Request, Response } from "express";
import { RolesEnum } from "~/common/enum";
import {
    CREATE_EMPLOYEE,
    CREATE_GUEST,
    CREATE_USER_WITH_ACCOUNT,
    DELETE_USER,
    UPDATE_EMPLOYEE,
    UPDATE_GUEST,
    UPDATE_USER,
    USER_DUPLICATE,
    USER_ROLE_ERROR,
} from "~/common/error-code/user";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import {
    IAccount,
    ICreateEmployeeBody,
    ICreateGuestBody,
    ICreateUserBody,
    ICreateUserWithAccountBody,
    IGetQuery,
    IUpdateEmployeeBody,
    IUpdateGuestBody,
    IUpdateUserBody,
    IUser,
} from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import {
    createEmployeeResource,
    createGuestResource,
    getUserResource,
    updateEmployeeResource,
    updateGuestResource,
} from "~/resources";
import { userService } from "~/services";
import { uploadToCloudinary } from "~/utils/cloudinary";
import { buildListParams } from "~/utils/pagination";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mã lỗi dùng chung (trùng dữ liệu, vai trò) -> key i18n; undefined nếu không phải mã chung. */
const commonErrorKey = (code: number): string | undefined => {
    switch (code) {
        case USER_DUPLICATE.USERNAME_EXISTS:
            return "user:username_exists";
        case USER_DUPLICATE.EMAIL_EXISTS:
            return "user:email_exists";
        case USER_DUPLICATE.PHONE_EXISTS:
            return "user:phone_exists";
        case USER_ROLE_ERROR.INVALID_ROLES:
            return "user:invalid_roles";
        case USER_ROLE_ERROR.ROLE_NOT_ASSIGNABLE:
            return "user:role_not_assignable";
        default:
            return undefined;
    }
};

const respondError = (req: Request, res: Response, code: number, specific: Record<number, string>, fallback: string) => {
    if (code === USER_ROLE_ERROR.ROLE_NOT_ASSIGNABLE) {
        return authorizationErrorResponse(res, req.t("user:role_not_assignable"));
    }
    const key = commonErrorKey(code) ?? specific[code] ?? fallback;
    return createErrorResponse(res, req.t(key));
};

/** Upload avatar nếu có file. Không có file thì KHÔNG đụng tới avatar hiện tại. */
const applyAvatar = async (req: Request, target: { avatar_url?: string | null }) => {
    if (req.file) {
        const result = await uploadToCloudinary(req.file.buffer);
        target.avatar_url = result.secure_url;
    } else {
        delete target.avatar_url;
    }
};

const isRole = (value: unknown): value is RolesEnum =>
    typeof value === "string" && (Object.values(RolesEnum) as string[]).includes(value);

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const createUser = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserBody = req.body;
        if (!body.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }
        await applyAvatar(req, body);

        const newUser: IUser | number = await userService.createUser(body);
        if (typeof newUser === "number") {
            return respondError(req, res, newUser, {}, "user:error_creating_user");
        }
        return createSuccessResponse(res, req.t("user:user_created_successfully"), getUserResource(newUser));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createUserWithAccount = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserWithAccountBody = req.body;
        if (!body.user?.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }
        await applyAvatar(req, body.user);

        const result = await userService.createUserWithAccount(body);
        if (typeof result === "number") {
            return respondError(
                req,
                res,
                result,
                {
                    [CREATE_USER_WITH_ACCOUNT.CREATE_ACCOUNT_FAILED]: "user:error_creating_account",
                    [CREATE_USER_WITH_ACCOUNT.CREATE_USER_FAILED]: "user:error_creating_user",
                },
                "user:error_creating_user_with_account",
            );
        }
        return createSuccessResponse(
            res,
            req.t("user:user_with_account_created_successfully"),
            createGuestResource(result),
        );
    } catch (error) {
        return serverErrorResponse(res);
    }
};

/** PATCH /users/:id: cập nhật hồ sơ cá nhân (của mình, hoặc người cấp dưới). */
export const updateUser = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateUserBody = req.body;
        await applyAvatar(req, body);

        const updatedUser = await userService.updateUser(body, id);
        if (typeof updatedUser === "number") {
            if (updatedUser === UPDATE_USER.NOT_FOUND) {
                return notFoundResponse(res, req.t("user:user_not_found"));
            }
            return respondError(req, res, updatedUser, {}, "user:error_updating_user");
        }
        return successResponse(res, req.t("user:user_updated_successfully"), getUserResource(updatedUser));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const deleteUserById = async (req: Request, res: Response, notFoundKey: string, failKey: string, okKey: string) => {
    try {
        const id = Number(req.params.id);
        if (req.user?.id === id) {
            return badRequestResponse(res, req.t("user:cannot_delete_self"));
        }
        const deletedUser = await userService.deleteUser(id);
        if (typeof deletedUser === "number") {
            switch (deletedUser) {
                case DELETE_USER.USER_NOT_FOUND:
                    return notFoundResponse(res, req.t(notFoundKey));
                case DELETE_USER.ACCOUNT_NOT_FOUND:
                    return notFoundResponse(res, req.t("user:account_not_found"));
                default:
                    return createErrorResponse(res, req.t(failKey));
            }
        }
        return successResponse(res, req.t(okKey), getUserResource(deletedUser));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteUser = (req: Request, res: Response) =>
    deleteUserById(req, res, "user:user_not_found", "user:error_deleting_user", "user:user_deleted_successfully");

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const query: IGetQuery = req.query;
        const allFilters = Array.isArray(query.filters) ? query.filters : [];

        // "role" không phải cột của users -> tách ra và lọc bằng EXISTS ở service
        const roleFilter = allFilters.find((f) => f.field === "role")?.value;
        if (roleFilter !== undefined && !isRole(roleFilter)) {
            return badRequestResponse(res, req.t("user:invalid_roles"));
        }
        const filters = withRestaurantScope(
            allFilters.filter((f) => f.field !== "role"),
            "restaurant_id",
            req.restaurantScope,
        );

        const params = buildListParams({ ...query, filters });
        const employees = await userService.getEmployees(params, roleFilter);
        if (typeof employees === "number") {
            return createErrorResponse(res, req.t("user:error_fetching_users"));
        }
        return getSuccessResponse(res, req.t("user:users_fetched_successfully"), employees);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createEmployee = async (req: Request, res: Response) => {
    try {
        const body: ICreateEmployeeBody = req.body;
        // Người bị giới hạn nhà hàng (manager...) chỉ tạo được nhân viên cho nhà hàng của mình
        if (req.restaurantScope) {
            body.user.restaurant_id = req.restaurantScope;
        }
        await applyAvatar(req, body.user);

        const result = await userService.createEmployee(body, req.roles || []);
        if (typeof result === "number") {
            return respondError(
                req,
                res,
                result,
                {
                    [CREATE_EMPLOYEE.CREATE_USER_WITH_ACCOUNT_FAILED]: "user:error_creating_user_with_account",
                    [CREATE_EMPLOYEE.ASSIGN_ROLES_FAILED]: "user:error_assigning_roles",
                },
                "user:error_creating_employee",
            );
        }
        return createSuccessResponse(res, req.t("user:employee_created_successfully"), createEmployeeResource(result));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateEmployeeBody = { ...req.body, user: req.body.user || {} };
        await applyAvatar(req, body.user);

        const result = await userService.updateEmployee(body, id, req.roles || []);
        if (typeof result === "number") {
            if (result === UPDATE_EMPLOYEE.USER_NOT_FOUND) {
                return notFoundResponse(res, req.t("user:employee_not_found"));
            }
            return respondError(
                req,
                res,
                result,
                {
                    [UPDATE_EMPLOYEE.ACCOUNT_NOT_FOUND]: "user:account_not_found",
                    [UPDATE_EMPLOYEE.ROLE_NOT_FOUND]: "user:role_not_found",
                    [UPDATE_EMPLOYEE.ADD_ROLES_FAILED]: "user:add_roles_failed",
                    [UPDATE_EMPLOYEE.REMOVE_ROLES_FAILED]: "user:remove_roles_failed",
                },
                "user:error_updating_employee",
            );
        }
        return successResponse(res, req.t("user:employee_updated_successfully"), updateEmployeeResource(result));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteEmployee = (req: Request, res: Response) =>
    deleteUserById(
        req,
        res,
        "user:employee_not_found",
        "user:error_deleting_employee",
        "user:employee_deleted_successfully",
    );

// ---------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------

export const createGuest = async (req: Request, res: Response) => {
    try {
        const body: ICreateGuestBody = req.body;
        await applyAvatar(req, body.user);

        const newGuest: { user: IUser; account: IAccount } | number = await userService.createGuest(body);
        if (typeof newGuest === "number") {
            return respondError(
                req,
                res,
                newGuest,
                {
                    [CREATE_GUEST.CREATE_USER_WITH_ACCOUNT_FAILED]: "user:error_creating_user_with_account",
                    [CREATE_GUEST.ASSIGN_ROLES_FAILED]: "user:error_assigning_roles",
                },
                "user:error_creating_guest",
            );
        }
        return createSuccessResponse(res, req.t("user:guest_created_successfully"), createGuestResource(newGuest));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getGuests = async (req: Request, res: Response) => {
    try {
        const params = buildListParams(req.query as IGetQuery);
        const guests = await userService.getGuests(params);
        if (typeof guests === "number") {
            return createErrorResponse(res, req.t("user:error_fetching_guests"));
        }
        return getSuccessResponse(res, req.t("user:guests_fetched_successfully"), guests);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateGuest = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateGuestBody = { ...req.body, user: req.body.user || {} };
        await applyAvatar(req, body.user);

        const updatedGuest = await userService.updateGuest(body, id);
        if (typeof updatedGuest === "number") {
            if (updatedGuest === UPDATE_GUEST.USER_NOT_FOUND) {
                return notFoundResponse(res, req.t("user:guest_not_found"));
            }
            return respondError(
                req,
                res,
                updatedGuest,
                { [UPDATE_GUEST.ACCOUNT_NOT_FOUND]: "user:account_not_found" },
                "user:error_updating_guest",
            );
        }
        return successResponse(res, req.t("user:guest_updated_successfully"), updateGuestResource(updatedGuest));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteGuest = (req: Request, res: Response) =>
    deleteUserById(req, res, "user:guest_not_found", "user:error_deleting_guest", "user:guest_deleted_successfully");
