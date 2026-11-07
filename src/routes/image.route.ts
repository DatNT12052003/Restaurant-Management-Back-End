import { Router } from "express";
import { imageController } from "~/controllers";
import { authMiddleware, authorizeImageAccess, loadUserContext, uploadImages, validate } from "~/middlewares";
import { getImagesSchema, imageIdSchema, uploadImagesSchema } from "~/schemas";

/** Ảnh của món, combo, nhà hàng, phòng. Quyền cần có tùy loại đối tượng (xem imageAccess.middleware.ts). */
const router = Router();

router.use(authMiddleware, loadUserContext);

router.get("/", validate(getImagesSchema), authorizeImageAccess("view"), imageController.getImages);
router.post(
    "/",
    uploadImages, // multipart: field "images" (nhiều file) + entity_type, entity_id
    validate(uploadImagesSchema),
    authorizeImageAccess("update"),
    imageController.uploadImages,
);
router.patch("/:id/primary", validate(imageIdSchema), authorizeImageAccess("update"), imageController.setPrimaryImage);
router.delete("/:id", validate(imageIdSchema), authorizeImageAccess("update"), imageController.deleteImage);

export default router;
