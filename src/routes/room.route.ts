import { Router } from "express";
import { RoomPermissionEnum } from "~/common/permission-enum";
import { roomController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant } from "~/middlewares";

const router = Router();

router.use(authMiddleware, checkPermission(RoomPermissionEnum.VIEW), restrictToRestaurant);

router.get("/all", roomController.getAllRooms);
router.get("/", roomController.getRooms);

export default router;
