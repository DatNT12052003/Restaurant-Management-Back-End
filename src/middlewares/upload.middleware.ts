import multer from "multer";
const memoryStorage = multer.memoryStorage();

export const uploadAvatar = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
}).single("avatar");

export const uploadMedia = multer({
    storage: memoryStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
}).single("media");
