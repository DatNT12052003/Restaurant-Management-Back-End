import { Router } from "express";
import { DishPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { createDishSchema, idParamSchema, updateDishSchema } from "~/schemas";
import { z } from "zod";

const router = Router();
const idParams = validate(z.object({ params: idParamSchema }));

router.use(authMiddleware);

router.get("/", checkPermission(DishPermissionEnum.VIEW), menuController.getDishes);
router.get("/:id", checkPermission(DishPermissionEnum.VIEW), idParams, menuController.getDishById);
router.post(
    "/",
    checkPermission(DishPermissionEnum.CREATE),
    validate(createDishSchema),
    auditRoute("dish.create", "dish"),
    menuController.createDish,
);
router.patch(
    "/:id",
    checkPermission(DishPermissionEnum.UPDATE),
    validate(updateDishSchema),
    auditRoute("dish.update", "dish", { before: AUDIT_BEFORE.dish }),
    menuController.updateDish,
);
router.delete(
    "/:id",
    checkPermission(DishPermissionEnum.DELETE),
    idParams,
    auditRoute("dish.delete", "dish", { before: AUDIT_BEFORE.dish, isDelete: true }),
    menuController.deleteDish,
);

export default router;
