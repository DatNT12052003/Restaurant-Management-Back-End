import { Response } from "express";
import { HTTP_RESPONSE } from "~/common/http-response";

export const serverErrorResponse = (res: Response) => {
    return res.status(HTTP_RESPONSE.INTERNAL_SERVER_ERROR.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.INTERNAL_SERVER_ERROR.statusCode,
        message: HTTP_RESPONSE.INTERNAL_SERVER_ERROR.message,
    });
};

export const badRequestResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
        message: message || HTTP_RESPONSE.BAD_REQUEST.message,
    });
};

export const createErrorResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
        message: message || HTTP_RESPONSE.BAD_REQUEST.message,
    });
};
