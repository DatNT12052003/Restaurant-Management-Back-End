import { Router } from "express";
import { ComboPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { authMiddleware, checkPermission, validate } from "~/middlewares";
import { createComboSchema, idParamSchema, updateComboSchema } from "~/schemas";
import { z } from "zod";

const router = Router();
const idParams = validate(z.object({ params: idParamSchema }));

router.use(authMiddleware);

router.get("/", checkPermission(ComboPermissionEnum.VIEW), menuController.getCombos);
router.get("/:id", checkPermission(ComboPermissionEnum.VIEW), idParams, menuController.getComboById);
router.post("/", checkPermission(ComboPermissionEnum.CREATE), validate(createComboSchema), menuController.createCombo);
router.patch(
    "/:id",
    checkPermission(ComboPermissionEnum.UPDATE),
    validate(updateComboSchema),
    menuController.updateCombo,
);
router.delete("/:id", checkPermission(ComboPermissionEnum.DELETE), idParams, menuController.deleteCombo);

export default router;
