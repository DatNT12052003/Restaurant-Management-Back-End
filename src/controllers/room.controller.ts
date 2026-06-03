import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import { createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { IGetQuery, IGetRooms, IRoom, ISelectQuery } from "~/interfaces";
import { roomService } from "~/services";

export const getAllRooms = async (req: Request, res: Response) => {
    try {
        const rooms: IRoom[] | number = await roomService.getAllRooms();
        if (typeof rooms === "number") {
            return createErrorResponse(res, req.t("room:error_getting_rooms"));
        }
        return getSuccessResponse(res, req.t("room:get_rooms_successfully"), rooms);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getRooms = async (req: Request, res: Response) => {
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

        const rooms: IGetRooms | number = await roomService.getRooms(params);

        if (typeof rooms === "number") {
            return createErrorResponse(res, req.t("room:error_getting_rooms"));
        }
        return getSuccessResponse(res, req.t("room:get_rooms_successfully"), rooms);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
