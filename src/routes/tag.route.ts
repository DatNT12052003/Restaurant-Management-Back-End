import { Router } from "express";
import { DishPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, validate } from "~/middlewares";
import { createTagSchema, idParamSchema, updateTagSchema } from "~/schemas";
import { z } from "zod";

/** Thẻ món ăn dùng chung nhóm quyền dish.* */
const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(DishPermissionEnum.VIEW), menuController.getTags);
router.post(
    "/",
    checkPermission(DishPermissionEnum.CREATE),
    validate(createTagSchema),
    auditRoute("tag.create", "tag"),
    menuController.createTag,
);
router.patch(
    "/:id",
    checkPermission(DishPermissionEnum.UPDATE),
    validate(updateTagSchema),
    auditRoute("tag.update", "tag"),
    menuController.updateTag,
);
router.delete(
    "/:id",
    checkPermission(DishPermissionEnum.DELETE),
    validate(z.object({ params: idParamSchema })),
    auditRoute("tag.delete", "tag", { isDelete: true }),
    menuController.deleteTag,
);

export default router;
