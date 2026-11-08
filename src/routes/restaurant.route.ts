import { Router } from "express";
import { RestaurantPermissionEnum, RoomPermissionEnum } from "~/common/permission-enum";
import { recipeController, restaurantController } from "~/controllers";
import {
    auditRoute,
    authMiddleware,
    checkAnyPermission,
    checkPermission,
    loadUserContext,
    restrictToRestaurant,
    validate,
} from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import {
    createClosedDaySchema,
    createRestaurantSchema,
    deleteClosedDaySchema,
    listClosedDaysSchema,
    restaurantIdSchema,
    updateRestaurantSchema,
} from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(RestaurantPermissionEnum.VIEW), restaurantController.getRestaurants);
// Danh sách rút gọn cho bộ chọn chi nhánh: người không phải admin chỉ thấy nhà hàng của mình
router.get("/all", loadUserContext, restaurantController.getAllRestaurants);
router.get(
    "/:id",
    checkPermission(RestaurantPermissionEnum.VIEW),
    validate(restaurantIdSchema),
    restrictToRestaurant,
    restaurantController.getRestaurantById,
);
router.post(
    "/",
    checkPermission(RestaurantPermissionEnum.CREATE),
    validate(createRestaurantSchema),
    auditRoute("restaurant.create", "restaurant", { restaurantId: (_r, d) => d?.id }),
    restaurantController.createRestaurant,
);
router.patch(
    "/:id",
    checkPermission(RestaurantPermissionEnum.UPDATE),
    validate(updateRestaurantSchema),
    auditRoute("restaurant.update", "restaurant", { before: AUDIT_BEFORE.restaurant, restaurantId: (r) => r.params.id }),
    restaurantController.updateRestaurant,
);
router.delete(
    "/:id",
    checkPermission(RestaurantPermissionEnum.DELETE),
    validate(restaurantIdSchema),
    auditRoute("restaurant.delete", "restaurant", { before: AUDIT_BEFORE.restaurant, restaurantId: (r) => r.params.id, isDelete: true }),
    restaurantController.deleteRestaurant,
);

// ---- Ngày nghỉ của chi nhánh (giai đoạn 10): không tính vào giờ mở cửa khi tính lấp đầy bàn ----
// Việc vận hành của chi nhánh: admin (restaurant.update) hoặc quản lý chi nhánh (room.update)
const MANAGE_CLOSED_DAYS = checkAnyPermission([RestaurantPermissionEnum.UPDATE, RoomPermissionEnum.UPDATE]);
router.get(
    "/:restaurantId/closed-days",
    checkPermission(RestaurantPermissionEnum.VIEW),
    validate(listClosedDaysSchema),
    restrictToRestaurant,
    recipeController.getClosedDays,
);
router.post(
    "/:restaurantId/closed-days",
    MANAGE_CLOSED_DAYS,
    validate(createClosedDaySchema),
    restrictToRestaurant,
    auditRoute("restaurant.closed_day_create", "restaurant", {
        entityId: (r) => r.params.restaurantId,
        restaurantId: (r) => r.params.restaurantId,
    }),
    recipeController.createClosedDay,
);
router.delete(
    "/:restaurantId/closed-days/:day",
    MANAGE_CLOSED_DAYS,
    validate(deleteClosedDaySchema),
    restrictToRestaurant,
    auditRoute("restaurant.closed_day_delete", "restaurant", {
        entityId: (r) => r.params.restaurantId,
        restaurantId: (r) => r.params.restaurantId,
        isDelete: true,
    }),
    recipeController.deleteClosedDay,
);

export default router;
