import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import { createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { IGetQuery, IGetTables, ISelectQuery, ITable } from "~/interfaces";
import { tableService } from "~/services";

export const getAllTables = async (req: Request, res: Response) => {
    try {
        const tables: ITable[] | number = await tableService.getAllTables();
        if (typeof tables === "number") {
            return createErrorResponse(res, req.t("table:error_getting_tables"));
        }
        return getSuccessResponse(res, req.t("table:get_tables_successfully"), tables);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getTables = async (req: Request, res: Response) => {
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
            returning: ["*"],
        };

        const tables: IGetTables | number = await tableService.getTables(params);

        if (typeof tables === "number") {
            return createErrorResponse(res, req.t("table:error_getting_tables"));
        }
        return getSuccessResponse(res, req.t("table:get_tables_successfully"), tables);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
