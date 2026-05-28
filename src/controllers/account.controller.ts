import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse } from "~/common/responses/success";
import {
    IAccount,
    ICreateAccountBody,
    ICreateAccountPayload,
    IGetAccounts,
    IGetQuery,
    ISelectQuery,
} from "~/interfaces";
import { accountService } from "~/services";

export const createAccount = async (req: Request, res: Response) => {
    try {
        const { username, password }: ICreateAccountBody = req.body;

        if (!username || !password) {
            return badRequestResponse(res, req.t("account:username_password_required"));
        }

        const newAccount: IAccount | number = await accountService.createAccount({ username, password });

        if (typeof newAccount === "number") {
            return createErrorResponse(res, req.t("account:error_creating_account"));
        }

        return createSuccessResponse(res, req.t("account:account_created_successfully"), newAccount);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getAccounts = async (req: Request, res: Response) => {
    try {
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
            returning: ["id", "username", "created_at", "updated_at", "deleted_at"],
        };

        const accounts: IGetAccounts | number = await accountService.getAccounts(params);

        if (typeof accounts === "number") {
            return createErrorResponse(res, req.t("account:error_getting_accounts"));
        }

        return getSuccessResponse(res, req.t("account:get_accounts_successfully"), accounts);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateAccount = (req: Request, res: Response) => {
    res.send("Update account");
};

export const deleteAccount = (req: Request, res: Response) => {
    res.send("Delete account");
};
