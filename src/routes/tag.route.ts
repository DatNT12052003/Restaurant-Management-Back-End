import { Router } from "express";
import { DishPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { authMiddleware, checkPermission, validate } from "~/middlewares";
import { createTagSchema, idParamSchema, updateTagSchema } from "~/schemas";
import { z } from "zod";

/** Thẻ món ăn dùng chung nhóm quyền dish.* */
const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(DishPermissionEnum.VIEW), menuController.getTags);
router.post("/", checkPermission(DishPermissionEnum.CREATE), validate(createTagSchema), menuController.createTag);
router.patch("/:id", checkPermission(DishPermissionEnum.UPDATE), validate(updateTagSchema), menuController.updateTag);
router.delete(
    "/:id",
    checkPermission(DishPermissionEnum.DELETE),
    validate(z.object({ params: idParamSchema })),
    menuController.deleteTag,
);

export default router;
