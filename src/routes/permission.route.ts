import { Router } from "express";
import { PermissionManagementEnum } from "~/common/permission-enum";
import { permissionController } from "~/controllers";
import { authMiddleware, checkPermission } from "~/middlewares";

const router = Router();

router.get("/", authMiddleware, checkPermission(PermissionManagementEnum.VIEW), permissionController.getPermissions);

export default router;
