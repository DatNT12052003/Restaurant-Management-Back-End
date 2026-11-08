import { Router } from "express";
import { ComboPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { createComboSchema, idParamSchema, updateComboSchema } from "~/schemas";
import { z } from "zod";

const router = Router();
const idParams = validate(z.object({ params: idParamSchema }));

router.use(authMiddleware);

router.get("/", checkPermission(ComboPermissionEnum.VIEW), menuController.getCombos);
router.get("/:id", checkPermission(ComboPermissionEnum.VIEW), idParams, menuController.getComboById);
router.post(
    "/",
    checkPermission(ComboPermissionEnum.CREATE),
    validate(createComboSchema),
    auditRoute("combo.create", "combo"),
    menuController.createCombo,
);
router.patch(
    "/:id",
    checkPermission(ComboPermissionEnum.UPDATE),
    validate(updateComboSchema),
    auditRoute("combo.update", "combo", { before: AUDIT_BEFORE.combo }),
    menuController.updateCombo,
);
router.delete(
    "/:id",
    checkPermission(ComboPermissionEnum.DELETE),
    idParams,
    auditRoute("combo.delete", "combo", { before: AUDIT_BEFORE.combo, isDelete: true }),
    menuController.deleteCombo,
);

export default router;
