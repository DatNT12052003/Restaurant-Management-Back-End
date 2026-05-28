import { Response } from "express";
import { HTTP_RESPONSE } from "~/common/http-response";

export const serverErrorResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.INTERNAL_SERVER_ERROR.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.INTERNAL_SERVER_ERROR.statusCode,
        message: message || HTTP_RESPONSE.INTERNAL_SERVER_ERROR.message,
    });
};

export const badRequestResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
        message: message || HTTP_RESPONSE.BAD_REQUEST.message,
    });
};

export const authorizationErrorResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.FORBIDDEN.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.FORBIDDEN.statusCode,
        message: message || HTTP_RESPONSE.FORBIDDEN.message,
    });
};

export const authenticationErrorResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.UNAUTHORIZED.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.UNAUTHORIZED.statusCode,
        message: message || HTTP_RESPONSE.UNAUTHORIZED.message,
    });
};

export const createErrorResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
        message: message || HTTP_RESPONSE.BAD_REQUEST.message,
    });
};
