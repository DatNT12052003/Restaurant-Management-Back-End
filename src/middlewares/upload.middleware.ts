import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { MAX_IMAGE_SIZE, MAX_IMAGES_PER_UPLOAD } from "~/common/constant";
import { badRequestResponse } from "~/common/responses/error";
const memoryStorage = multer.memoryStorage();

export const uploadAvatar = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
}).single("avatar");

export const uploadMedia = multer({
    storage: memoryStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
}).single("media");

/**
 * Tải nhiều ảnh (field "images", tối đa MAX_IMAGES_PER_UPLOAD file, mỗi file tối đa MAX_IMAGE_SIZE).
 * Lỗi của multer (file quá lớn, quá nhiều file, không phải ảnh) trả về 400 thay vì 500.
 */
const INVALID_IMAGE_TYPE = "INVALID_IMAGE_TYPE";

const imagesUploader = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_IMAGES_PER_UPLOAD },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) return cb(null, true);
        cb(new Error(INVALID_IMAGE_TYPE));
    },
}).array("images", MAX_IMAGES_PER_UPLOAD);

export const uploadImages = (req: Request, res: Response, next: NextFunction) => {
    imagesUploader(req, res, (error: unknown) => {
        if (!error) return next();
        if (error instanceof Error && error.message === INVALID_IMAGE_TYPE) {
            return badRequestResponse(res, req.t("image:invalid_type"));
        }
        if (error instanceof multer.MulterError) {
            const key =
                error.code === "LIMIT_FILE_SIZE"
                    ? "image:file_too_large"
                    : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
                      ? "image:invalid_files"
                      : "image:upload_failed";
            return badRequestResponse(res, req.t(key, { max: MAX_IMAGES_PER_UPLOAD, size: MAX_IMAGE_SIZE / 1024 / 1024 }));
        }
        next(error);
    });
};
