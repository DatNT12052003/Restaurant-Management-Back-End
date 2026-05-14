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
        serverErrorResponse(res);
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
        serverErrorResponse(res);
    }
};

export const getUsersWithAccountInfo = async (req: Request, res: Response) => {
    try {
        const query: IGetQuery = req.query;
        console.log("🚀 ~ file: user.controller.ts:114 ~ getUsersWithAccountInfo ~ query:", query);
        const currentPage = query.currentPage || PAGINATION.DEFAULT_PAGE;
        const limit = query.limit || PAGINATION.DEFAULT_LIMIT;
        const offset = (currentPage - 1) * limit;

        const params: ISelectQuery = {
            search: query.search,
            filters: query.filters,
            orderBy: query.orderBy,
            limit,
            offset,
            returning: ["*"],
        };
        console.log("🚀 ~ file: user.controller.ts:122 ~ getUsersWithAccountInfo ~ params:", params);
        const users: IGetEmployees | null = await userService.getEmployees(params);
        if (!users) {
            return createErrorResponse(res, req.t("user:error_fetching_users"));
        }
        return createSuccessResponse(res, req.t("user:users_fetched_successfully"), users);
    } catch (error) {
        serverErrorResponse(res);
    }
};
