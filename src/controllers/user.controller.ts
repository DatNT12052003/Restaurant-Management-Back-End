import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import {
    CREATE_EMPLOYEE,
    CREATE_GUEST,
    CREATE_USER_WITH_ACCOUNT,
    UPDATE_EMPLOYEE,
    UPDATE_GUEST,
    UPDATE_USER,
} from "~/common/error-code/user";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse } from "~/common/responses/success";
import {
    IAccount,
    IUser,
    IResponse,
    ICreateUserBody,
    ICreateUserWithAccountBody,
    IUserWithAccount,
    IGetQuery,
    ISelectQuery,
    IGetEmployees,
    IUpdateUserBody,
    ICreateEmployeeBody,
    IUpdateEmployeeBody,
    ICreateGuestBody,
    IUpdateGuestBody,
} from "~/interfaces";
import { createEmployeeResource, createGuestResource, updateEmployeeResource, updateGuestResource } from "~/resources";
import { userService } from "~/services";
import { uploadToCloudinary } from "~/utils/cloudinary";

export const createUser = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserBody = req.body;

        if (!body.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }

        if (!req.file) {
            body.avatar_url = null;
        }

        const newUser: IUser | number = await userService.createUser(body);

        if (typeof newUser === "number") {
            return createErrorResponse(res, req.t("user:error_creating_user"));
        }

        return createSuccessResponse(res, req.t("user:user_created_successfully"), newUser);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createUserWithAccount = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserWithAccountBody = req.body;

        if (!body.user.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }

        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }

        const newUserWithAccount: { user: IUser; account: IAccount } | number =
            await userService.createUserWithAccount(body);

        if (typeof newUserWithAccount === "number") {
            switch (newUserWithAccount) {
                case CREATE_USER_WITH_ACCOUNT.CREATE_ACCOUNT_FAILED:
                    return createErrorResponse(res, req.t("user:error_creating_account"));
                case CREATE_USER_WITH_ACCOUNT.CREATE_USER_FAILED:
                    return createErrorResponse(res, req.t("user:error_creating_user"));
                default:
                    return createErrorResponse(res, req.t("user:error_creating_user_with_account"));
            }
        }

        return createSuccessResponse(res, req.t("user:user_with_account_created_successfully"), newUserWithAccount);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateUser = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateUserBody = req.body;
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.avatar_url = result.secure_url;
        } else {
            body.avatar_url = null;
        }
        if (isNaN(id)) {
            return badRequestResponse(res, req.t("user:invalid_user_id"));
        }
        const updatedUser: IUser | number = await userService.updateUser(body, id);
        if (typeof updatedUser === "number") {
            switch (updatedUser) {
                case UPDATE_USER.NOT_FOUND:
                    return createErrorResponse(res, req.t("user:user_not_found"));
                default:
                    return createErrorResponse(res, req.t("user:error_updating_user"));
            }
        }
        return createSuccessResponse(res, req.t("user:user_updated_successfully"), updatedUser);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return badRequestResponse(res, req.t("user:invalid_user_id"));
        }
        const deletedUser: IUser | number = await userService.deleteUser(id);
        if (typeof deletedUser === "number") {
            switch (deletedUser) {
                case 1:
                    return createErrorResponse(res, req.t("user:user_not_found"));
                case 2:
                    return createErrorResponse(res, req.t("user:account_not_found"));
                default:
                    return createErrorResponse(res, req.t("user:error_deleting_user"));
            }
        }
        return createSuccessResponse(res, req.t("user:user_deleted_successfully"), deletedUser);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getEmployeesByRestaurantId = async (req: Request, res: Response) => {
    try {
        const restaurant_id = Number(req.params.restaurant_id);
        const query: IGetQuery = req.query;
        const currentPage = query.currentPage || PAGINATION.DEFAULT_PAGE;
        const limit = query.limit || PAGINATION.DEFAULT_LIMIT;
        const offset = (currentPage - 1) * limit;

        const params: ISelectQuery = {
            search: query.search,
            filters: query.filters,
            orderBy: query.orderBy,
            limit,
            offset,
            returning: ["u.*", "a.username"],
        };
        const users: IGetEmployees | number = await userService.getEmployeesByRestaurantId(params, restaurant_id);
        if (typeof users === "number") {
            return createErrorResponse(res, req.t("user:error_fetching_users"));
        }
        return createSuccessResponse(res, req.t("user:users_fetched_successfully"), users);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createEmployee = async (req: Request, res: Response) => {
    try {
        const body: ICreateEmployeeBody = req.body;
        if (!body.user.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }
        const newUserWithAccount: { user: IUser; account: IAccount; roles: string[] } | number =
            await userService.createEmployee(body);
        if (typeof newUserWithAccount === "number") {
            switch (newUserWithAccount) {
                case CREATE_EMPLOYEE.CREATE_USER_WITH_ACCOUNT_FAILED:
                    return createErrorResponse(res, req.t("user:error_creating_user_with_account"));
                case CREATE_EMPLOYEE.ASSIGN_ROLES_FAILED:
                    return createErrorResponse(res, req.t("user:error_assigning_roles"));
                default:
                    return createErrorResponse(res, req.t("user:error_creating_employee"));
            }
        }
        return createSuccessResponse(
            res,
            req.t("user:employee_created_successfully"),
            createEmployeeResource(newUserWithAccount),
        );
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateEmployeeBody = req.body;
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }

        if (isNaN(id)) {
            return badRequestResponse(res, req.t("user:invalid_user_id"));
        }
        const updatedEmployee = await userService.updateEmployee(body, id);
        if (typeof updatedEmployee === "number") {
            switch (updatedEmployee) {
                case UPDATE_EMPLOYEE.USER_NOT_FOUND:
                    return createErrorResponse(res, req.t("user:user_not_found"));
                case UPDATE_EMPLOYEE.ACCOUNT_NOT_FOUND:
                    return createErrorResponse(res, req.t("user:account_not_found"));
                case UPDATE_EMPLOYEE.ROLE_NOT_FOUND:
                    return createErrorResponse(res, req.t("user:role_not_found"));
                case UPDATE_EMPLOYEE.ADD_ROLES_FAILED:
                    return createErrorResponse(res, req.t("user:add_roles_failed"));
                case UPDATE_EMPLOYEE.REMOVE_ROLES_FAILED:
                    return createErrorResponse(res, req.t("user:remove_roles_failed"));
                case UPDATE_EMPLOYEE.UPDATE_EMPLOYEE_FAILED:
                    return createErrorResponse(res, req.t("user:update_employee_failed"));
                default:
                    return createErrorResponse(res, req.t("user:error_updating_employee"));
            }
        }
        return createSuccessResponse(
            res,
            req.t("user:employee_updated_successfully"),
            updateEmployeeResource(updatedEmployee),
        );
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createGuest = async (req: Request, res: Response) => {
    try {
        const body: ICreateGuestBody = req.body;
        if (!body.user.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }
        const newGuest: { user: IUser; account: IAccount } | number = await userService.createGuest(body);
        if (typeof newGuest === "number") {
            switch (newGuest) {
                case CREATE_GUEST.CREATE_USER_WITH_ACCOUNT_FAILED:
                    return createErrorResponse(res, req.t("user:error_creating_user_with_account"));
                case CREATE_GUEST.ASSIGN_ROLES_FAILED:
                    return createErrorResponse(res, req.t("user:error_assigning_roles"));
                case CREATE_GUEST.CREATE_GUEST_FAILED:
                    return createErrorResponse(res, req.t("user:error_creating_guest"));
                default:
                    return createErrorResponse(res, req.t("user:error_creating_guest"));
            }
        }
        return createSuccessResponse(res, req.t("user:guest_created_successfully"), createGuestResource(newGuest));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateGuest = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const body: IUpdateGuestBody = req.body;
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }
        if (isNaN(id)) {
            return badRequestResponse(res, req.t("user:invalid_user_id"));
        }
        const updatedGuest = await userService.updateGuest(body, id);
        if (typeof updatedGuest === "number") {
            switch (updatedGuest) {
                case UPDATE_GUEST.USER_NOT_FOUND:
                    return createErrorResponse(res, req.t("user:user_not_found"));
                case UPDATE_GUEST.ACCOUNT_NOT_FOUND:
                    return createErrorResponse(res, req.t("user:account_not_found"));
                case UPDATE_GUEST.UPDATE_GUEST_FAILED:
                    return createErrorResponse(res, req.t("user:update_guest_failed"));
                default:
                    return createErrorResponse(res, req.t("user:error_updating_guest"));
            }
        }
        return createSuccessResponse(res, req.t("user:guest_updated_successfully"), updateGuestResource(updatedGuest));
    } catch (error) {
        return serverErrorResponse(res);
    }
};
