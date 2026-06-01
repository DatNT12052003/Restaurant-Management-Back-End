import { Request, Response } from "express";
import { createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { IRoom } from "~/interfaces";
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
