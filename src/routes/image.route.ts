import { Router } from "express";
import { imageController } from "~/controllers";
import { auditRoute, authMiddleware, authorizeImageAccess, loadUserContext, uploadImages, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
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
    // Ghi vào đối tượng sở hữu ảnh (món, combo, nhà hàng, phòng)
    auditRoute("image.upload", (req) => String(req.body.entity_type), { entityId: (req) => req.body.entity_id }),
    imageController.uploadImages,
);
router.patch(
    "/:id/primary",
    validate(imageIdSchema),
    authorizeImageAccess("update"),
    auditRoute("image.set_primary", "image", { before: AUDIT_BEFORE.image }),
    imageController.setPrimaryImage,
);
router.delete(
    "/:id",
    validate(imageIdSchema),
    authorizeImageAccess("update"),
    auditRoute("image.delete", "image", { before: AUDIT_BEFORE.image, isDelete: true }),
    imageController.deleteImage,
);

export default router;
