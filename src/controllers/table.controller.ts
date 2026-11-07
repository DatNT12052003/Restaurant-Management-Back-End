import { Request, Response } from "express";
import { TABLE_ERROR } from "~/common/error-code/table";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { tableService } from "~/services";
import { buildListParams } from "~/utils/pagination";

const respondError = (req: Request, res: Response, code: number, fallback: string) => {
    switch (code) {
        case TABLE_ERROR.NOT_FOUND:
            return notFoundResponse(res, req.t("table:not_found"));
        case TABLE_ERROR.ROOM_NOT_FOUND:
            return notFoundResponse(res, req.t("room:not_found"));
        case TABLE_ERROR.ROOM_FULL:
            return badRequestResponse(res, req.t("table:room_full"));
        case TABLE_ERROR.DUPLICATE_NAME:
            return badRequestResponse(res, req.t("table:duplicate_name"));
        case TABLE_ERROR.IN_USE:
            return badRequestResponse(res, req.t("table:in_use"));
        case TABLE_ERROR.HAS_OPEN_ORDER:
            return badRequestResponse(res, req.t("table:has_open_order"));
        case TABLE_ERROR.HAS_RESERVATIONS:
            return badRequestResponse(res, req.t("table:has_reservations"));
        default:
            return createErrorResponse(res, req.t(fallback));
    }
};

export const getAllTables = async (req: Request, res: Response) => {
    try {
        // Admin có thể lọc theo nhà hàng qua ?restaurant_id=
        const restaurantId = req.restaurantScope ?? (Number(req.query.restaurant_id) || null);
        const tables = await tableService.getAllTables(restaurantId);
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
        const query = req.query as IGetQuery;
        const params = buildListParams(
            { ...query, filters: withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope) },
            { returning: ["t.*", "r.restaurant_id"] },
        );
        const tables = await tableService.getTables(params);
        if (typeof tables === "number") {
            return createErrorResponse(res, req.t("table:error_getting_tables"));
        }
        return getSuccessResponse(res, req.t("table:get_tables_successfully"), tables);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getTableById = async (req: Request, res: Response) => {
    try {
        const table = await tableService.getTableById(Number(req.params.id), req.restaurantScope);
        if (typeof table === "number") {
            return respondError(req, res, table, "table:error_getting_tables");
        }
        return getSuccessResponse(res, req.t("table:get_table_successfully"), table);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createTable = async (req: Request, res: Response) => {
    try {
        const table = await tableService.createTable(req.body, req.restaurantScope);
        if (typeof table === "number") {
            return respondError(req, res, table, "table:create_failed");
        }
        return createSuccessResponse(res, req.t("table:created_successfully"), table);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateTable = async (req: Request, res: Response) => {
    try {
        const table = await tableService.updateTable(Number(req.params.id), req.body, req.restaurantScope);
        if (typeof table === "number") {
            return respondError(req, res, table, "table:update_failed");
        }
        return successResponse(res, req.t("table:updated_successfully"), table);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteTable = async (req: Request, res: Response) => {
    try {
        const result = await tableService.deleteTable(Number(req.params.id), req.restaurantScope);
        if (typeof result === "number") {
            return respondError(req, res, result, "table:delete_failed");
        }
        return successResponse(res, req.t("table:deleted_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
