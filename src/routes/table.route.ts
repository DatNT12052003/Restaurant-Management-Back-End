import { Router } from "express";
import { TablePermissionEnum } from "~/common/permission-enum";
import { tableController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant } from "~/middlewares";

const router = Router();

router.use(authMiddleware, checkPermission(TablePermissionEnum.VIEW), restrictToRestaurant);

router.get("/all", tableController.getAllTables);
router.get("/", tableController.getTables);

export default router;
