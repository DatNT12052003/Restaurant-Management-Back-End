import { Request, Response } from "express";
import { createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { ITable } from "~/interfaces";
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
