import { Request, Response } from "express";
import { ImageEntityEnum } from "~/common/enum";
import { IMAGE_ERROR } from "~/common/error-code/menu";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { imageService } from "~/services";

const respondError = (req: Request, res: Response, code: number) => {
    switch (code) {
        case IMAGE_ERROR.NOT_FOUND:
            return notFoundResponse(res, req.t("image:not_found"));
        case IMAGE_ERROR.NO_FILES:
            return badRequestResponse(res, req.t("image:no_files"));
        case IMAGE_ERROR.UPLOAD_FAILED:
            return createErrorResponse(res, req.t("image:upload_failed"));
        default:
            return createErrorResponse(res, req.t("image:failed"));
    }
};

export const getImages = async (req: Request, res: Response) => {
    try {
        const result = await imageService.getImages(
            req.query.entity_type as ImageEntityEnum,
            Number(req.query.entity_id),
        );
        if (typeof result === "number") return respondError(req, res, result);
        return getSuccessResponse(res, req.t("image:get_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const uploadImages = async (req: Request, res: Response) => {
    try {
        const files = (req.files as Express.Multer.File[] | undefined) || [];
        const result = await imageService.uploadImages(req.body.entity_type, Number(req.body.entity_id), files);
        if (typeof result === "number") return respondError(req, res, result);
        return createSuccessResponse(res, req.t("image:upload_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const setPrimaryImage = async (req: Request, res: Response) => {
    try {
        const result = await imageService.setPrimary(req.image!);
        if (typeof result === "number") return respondError(req, res, result);
        return successResponse(res, req.t("image:primary_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteImage = async (req: Request, res: Response) => {
    try {
        const result = await imageService.deleteImage(req.image!);
        if (typeof result === "number") return respondError(req, res, result);
        return successResponse(res, req.t("image:delete_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
