import multer from "multer";
import { storage } from "../config/cloudinary";

export const uploadAvatar = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
}).single("avatar");

export const uploadMedia = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
}).single("media");
