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

export const notFoundResponse = (res: Response, message?: string) => {
    return res.status(HTTP_RESPONSE.NOT_FOUND.statusCode).json({
        success: false,
        statusCode: HTTP_RESPONSE.NOT_FOUND.statusCode,
        message: message || HTTP_RESPONSE.NOT_FOUND.message,
    });
};

/** 409: thao tác cần người dùng xác nhận lại (ví dụ tạm khóa phòng còn lịch đặt bàn) */
export const conflictResponse = (res: Response, message?: string) => {
    return res.status(409).json({
        success: false,
        statusCode: 409,
        message: message || "Conflict",
    });
};

export const tooManyRequestsResponse = (res: Response, message?: string) => {
    return res.status(429).json({
        success: false,
        statusCode: 429,
        message: message || "Too many requests",
    });
};
