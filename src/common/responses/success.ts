import { Response } from "express";
import { HTTP_RESPONSE } from "~/common/http-response";

export const createSuccessResponse = (res: Response, data: any) => {
    return res.status(HTTP_RESPONSE.CREATED.statusCode).json({
        success: true,
        statusCode: HTTP_RESPONSE.CREATED.statusCode,
        message: HTTP_RESPONSE.CREATED.message,
        data: data,
    });
};

export const getSuccessResponse = (res: Response, data: any) => {
    return res.status(HTTP_RESPONSE.SUCCESS.statusCode).json({
        success: true,
        statusCode: HTTP_RESPONSE.SUCCESS.statusCode,
        message: HTTP_RESPONSE.SUCCESS.message,
        data: data,
    });
};
