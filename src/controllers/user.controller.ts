import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
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
} from "~/interfaces";
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

        const newUser: IUser | null = await userService.createUser(body);

        if (!newUser) {
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

        const newUserWithAccount: { user: IUser; account: IAccount } | null =
            await userService.createUserWithAccount(body);

        if (!newUserWithAccount?.user || !newUserWithAccount?.account) {
            return createErrorResponse(res, req.t("user:error_creating_user_with_account"));
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
        const updatedUser: IUser | null = await userService.updateUser(body, id);
        if (!updatedUser) {
            return createErrorResponse(res, req.t("user:error_updating_user"));
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
        const deletedUser: IUser | null = await userService.deleteUser(id);
        if (!deletedUser) {
            return createErrorResponse(res, req.t("user:error_deleting_user"));
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
        const users: IGetEmployees | null = await userService.getEmployeesByRestaurantId(params, restaurant_id);
        if (!users) {
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
        const newUserWithAccount: { user: IUser; account: IAccount } | null = await userService.createEmployee(body);
        if (!newUserWithAccount?.user || !newUserWithAccount?.account) {
            return createErrorResponse(res, req.t("user:error_creating_employee"));
        }
        return createSuccessResponse(res, req.t("user:employee_created_successfully"), newUserWithAccount);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
