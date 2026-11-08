import { Router } from "express";
import { RoomPermissionEnum } from "~/common/permission-enum";
import { roomController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
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
    auditRoute("room.create", "room"),
    roomController.createRoom,
);
router.patch(
    "/:id",
    checkPermission(RoomPermissionEnum.UPDATE),
    validate(updateRoomSchema),
    restrictToRestaurant,
    auditRoute("room.update", "room", { before: AUDIT_BEFORE.room }),
    roomController.updateRoom,
);
router.delete(
    "/:id",
    checkPermission(RoomPermissionEnum.DELETE),
    validate(roomIdSchema),
    restrictToRestaurant,
    auditRoute("room.delete", "room", { before: AUDIT_BEFORE.room, isDelete: true }),
    roomController.deleteRoom,
);

export default router;
