import { Router } from "express";
import { ReservationPermissionEnum } from "~/common/permission-enum";
import { reservationController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import {
    availableTablesSchema,
    createReservationSchema,
    listReservationsSchema,
    reservationIdSchema,
    reservationScheduleSchema,
    updateReservationSchema,
    updateReservationStatusSchema,
} from "~/schemas";

/**
 * Đặt bàn (đặc tả 4.6). `restrictToRestaurant` chặn người không phải admin chỉ định nhà hàng khác
 * (query/body `restaurant_id`); với `/:id`, service kiểm tra reservation thuộc phạm vi.
 */
const router = Router();

router.use(authMiddleware);

router.get(
    "/",
    checkPermission(ReservationPermissionEnum.VIEW),
    validate(listReservationsSchema),
    restrictToRestaurant,
    reservationController.getReservations,
);
// Lịch theo ngày/tuần: mọi reservation giao với [from, to), không phân trang
router.get(
    "/schedule",
    checkPermission(ReservationPermissionEnum.VIEW),
    validate(reservationScheduleSchema),
    restrictToRestaurant,
    reservationController.getSchedule,
);
// Bàn trống trong khoảng thời gian + gợi ý bàn theo số khách
router.get(
    "/available-tables",
    checkPermission(ReservationPermissionEnum.VIEW),
    validate(availableTablesSchema),
    restrictToRestaurant,
    reservationController.getAvailableTables,
);
router.get(
    "/:id",
    checkPermission(ReservationPermissionEnum.VIEW),
    validate(reservationIdSchema),
    restrictToRestaurant,
    reservationController.getReservationById,
);
router.post(
    "/",
    checkPermission(ReservationPermissionEnum.CREATE),
    validate(createReservationSchema),
    restrictToRestaurant,
    reservationController.createReservation,
);
router.patch(
    "/:id/status",
    checkPermission(ReservationPermissionEnum.UPDATE),
    validate(updateReservationStatusSchema),
    restrictToRestaurant,
    reservationController.updateReservationStatus,
);
router.patch(
    "/:id",
    checkPermission(ReservationPermissionEnum.UPDATE),
    validate(updateReservationSchema),
    restrictToRestaurant,
    reservationController.updateReservation,
);
router.delete(
    "/:id",
    checkPermission(ReservationPermissionEnum.DELETE),
    validate(reservationIdSchema),
    restrictToRestaurant,
    reservationController.deleteReservation,
);

export default router;
