import { Router } from "express";
import { DishPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { authMiddleware, checkPermission, validate } from "~/middlewares";
import { createDishSchema, idParamSchema, updateDishSchema } from "~/schemas";
import { z } from "zod";

const router = Router();
const idParams = validate(z.object({ params: idParamSchema }));

router.use(authMiddleware);

router.get("/", checkPermission(DishPermissionEnum.VIEW), menuController.getDishes);
router.get("/:id", checkPermission(DishPermissionEnum.VIEW), idParams, menuController.getDishById);
router.post("/", checkPermission(DishPermissionEnum.CREATE), validate(createDishSchema), menuController.createDish);
router.patch("/:id", checkPermission(DishPermissionEnum.UPDATE), validate(updateDishSchema), menuController.updateDish);
router.delete("/:id", checkPermission(DishPermissionEnum.DELETE), idParams, menuController.deleteDish);

export default router;
