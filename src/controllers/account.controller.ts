import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import { OrderTypeEnum } from "~/common/enum";
import { HTTP_RESPONSE } from "~/common/http-response";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse } from "~/common/responses/success";
import { ICreateAccountPayload, IGetDataParams, IGetParams, IResponse } from "~/interfaces";
import { accountService } from "~/services";

export const createAccount = async (req: Request, res: Response) => {
    try {
        const { username, password }: ICreateAccountPayload = req.body;

        if (!username || !password) {
            return badRequestResponse(res, "Username and password are required.");
        }

        const response: IResponse<any> = await accountService.createAccount({ username, password });

        if (!response.success) {
            return createErrorResponse(res, "Failed to create account.");
        }

        return createSuccessResponse(res, response.data);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const getAccounts = async (req: Request, res: Response) => {
    try {
        const currentPage = parseInt(req.query.currentPage as string) || PAGINATION.DEFAULT_PAGE;
        const limit = parseInt(req.query.limit as string) || PAGINATION.DEFAULT_LIMIT;
        const offset = (currentPage - 1) * limit;
        const searchText = (req.query.searchText as string) || "";
        const searchField = (req.query.searchField as string) || "username";
        const filterField = (req.query.filterField as string) || "";
        const filterValue = (req.query.filterValue as string) || "";
        const orderBy = (req.query.orderBy as string) || "created_at";
        const orderType = (
            ((req.query.orderType as OrderTypeEnum) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC"
        ) as OrderTypeEnum;

        const params: IGetDataParams = {
            searchText,
            searchField,
            filterField,
            filterValue,
            orderBy,
            orderType,
            offset,
            limit,
        };

        const response: IResponse<any> = await accountService.getAccounts(params);

        if (!response.success) {
            return createErrorResponse(res, "Failed to retrieve accounts.");
        }

        return getSuccessResponse(res, response.data);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const updateAccount = (req: Request, res: Response) => {
    res.send("Update account");
};

export const deleteAccount = (req: Request, res: Response) => {
    res.send("Delete account");
};
