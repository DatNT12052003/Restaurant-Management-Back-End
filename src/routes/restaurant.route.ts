import { Router } from "express";
import { RestaurantPermissionEnum } from "~/common/permission-enum";
import { restaurantController } from "~/controllers";
import {
    auditRoute,
    authMiddleware,
    checkPermission,
    loadUserContext,
    restrictToRestaurant,
    validate,
} from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { createRestaurantSchema, restaurantIdSchema, updateRestaurantSchema } from "~/schemas";

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

export default router;
