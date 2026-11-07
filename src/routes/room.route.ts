import { Router } from "express";
import { RoomPermissionEnum } from "~/common/permission-enum";
import { roomController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { createRoomSchema, roomIdSchema, updateRoomSchema } from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/all", checkPermission(RoomPermissionEnum.VIEW), restrictToRestaurant, roomController.getAllRooms);
router.get("/", checkPermission(RoomPermissionEnum.VIEW), restrictToRestaurant, roomController.getRooms);
router.get(
    "/:id",
    checkPermission(RoomPermissionEnum.VIEW),
    validate(roomIdSchema),
    restrictToRestaurant,
    roomController.getRoomById,
);
router.post(
    "/",
    checkPermission(RoomPermissionEnum.CREATE),
    validate(createRoomSchema),
    restrictToRestaurant,
    roomController.createRoom,
);
router.patch(
    "/:id",
    checkPermission(RoomPermissionEnum.UPDATE),
    validate(updateRoomSchema),
    restrictToRestaurant,
    roomController.updateRoom,
);
router.delete(
    "/:id",
    checkPermission(RoomPermissionEnum.DELETE),
    validate(roomIdSchema),
    restrictToRestaurant,
    roomController.deleteRoom,
);

export default router;
