import { Router } from "express";
import { PermissionManagementEnum } from "~/common/permission-enum";
import { permissionController } from "~/controllers";
import { authMiddleware, checkPermission, validate } from "~/middlewares";
import { updateRolePermissionsSchema } from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(PermissionManagementEnum.VIEW), permissionController.getRoles);
router.put(
    "/:id/permissions",
    checkPermission(PermissionManagementEnum.ASSIGN),
    validate(updateRolePermissionsSchema),
    permissionController.updateRolePermissions,
);

export default router;
