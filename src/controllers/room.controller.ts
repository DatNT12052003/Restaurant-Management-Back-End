import { Request, Response } from "express";
import { ROOM_ERROR } from "~/common/error-code/room";
import {
    badRequestResponse,
    conflictResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { roomService } from "~/services";
import { buildListParams } from "~/utils/pagination";

const respondError = (req: Request, res: Response, code: number, fallback: string) => {
    switch (code) {
        case ROOM_ERROR.NOT_FOUND:
            return notFoundResponse(res, req.t("room:not_found"));
        case ROOM_ERROR.RESTAURANT_NOT_FOUND:
            return notFoundResponse(res, req.t("restaurant:not_found"));
        case ROOM_ERROR.RESTAURANT_REQUIRED:
            return badRequestResponse(res, req.t("room:restaurant_required"));
        case ROOM_ERROR.TOO_MANY_TABLES:
            return badRequestResponse(res, req.t("room:too_many_tables"));
        case ROOM_ERROR.IN_USE:
            return badRequestResponse(res, req.t("room:in_use"));
        case ROOM_ERROR.HAS_RESERVATIONS:
            return badRequestResponse(res, req.t("room:has_reservations"));
        case ROOM_ERROR.HAS_UPCOMING_RESERVATIONS:
            return conflictResponse(res, req.t("room:has_upcoming_reservations"));
        default:
            return createErrorResponse(res, req.t(fallback));
    }
};

export const getAllRooms = async (req: Request, res: Response) => {
    try {
        // Admin có thể lọc theo nhà hàng qua ?restaurant_id=
        const restaurantId = req.restaurantScope ?? (Number(req.query.restaurant_id) || null);
        const rooms = await roomService.getAllRooms(restaurantId);
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
        const query = req.query as IGetQuery;
        const params = buildListParams({
            ...query,
            filters: withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope),
        });
        const rooms = await roomService.getRooms(params);
        if (typeof rooms === "number") {
            return createErrorResponse(res, req.t("room:error_getting_rooms"));
        }
        return getSuccessResponse(res, req.t("room:get_rooms_successfully"), rooms);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getRoomById = async (req: Request, res: Response) => {
    try {
        const room = await roomService.getRoomById(Number(req.params.id), req.restaurantScope);
        if (typeof room === "number") {
            return respondError(req, res, room, "room:error_getting_rooms");
        }
        return getSuccessResponse(res, req.t("room:get_room_successfully"), room);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createRoom = async (req: Request, res: Response) => {
    try {
        const room = await roomService.createRoom(req.body, req.restaurantScope);
        if (typeof room === "number") {
            return respondError(req, res, room, "room:create_failed");
        }
        return createSuccessResponse(res, req.t("room:created_successfully"), room);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateRoom = async (req: Request, res: Response) => {
    try {
        const room = await roomService.updateRoom(Number(req.params.id), req.body, req.restaurantScope);
        if (typeof room === "number") {
            return respondError(req, res, room, "room:update_failed");
        }
        return successResponse(res, req.t("room:updated_successfully"), room);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteRoom = async (req: Request, res: Response) => {
    try {
        const result = await roomService.deleteRoom(Number(req.params.id), req.restaurantScope);
        if (typeof result === "number") {
            return respondError(req, res, result, "room:delete_failed");
        }
        return successResponse(res, req.t("room:deleted_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
