import { Router } from "express";
import { DishPermissionEnum } from "~/common/permission-enum";
import { menuController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { restaurantMenuSchema, updateRestaurantMenuItemSchema } from "~/schemas";

/**
 * Thực đơn của từng nhà hàng: thực đơn chung + tùy chỉnh (bật/tắt, giá riêng).
 * `restrictToRestaurant` chặn người không phải admin thao tác trên nhà hàng khác (đọc req.params.restaurantId).
 */
const router = Router();

router.use(authMiddleware);

router.get(
    "/:restaurantId",
    checkPermission(DishPermissionEnum.VIEW),
    validate(restaurantMenuSchema),
    restrictToRestaurant,
    menuController.getRestaurantMenu,
);
router.patch(
    "/:restaurantId/dishes/:itemId",
    checkPermission(DishPermissionEnum.AVAILABILITY),
    validate(updateRestaurantMenuItemSchema),
    restrictToRestaurant,
    auditRoute("restaurant_menu.dish_update", "dish", { entityId: (r) => r.params.itemId }),
    menuController.updateRestaurantDish,
);
router.patch(
    "/:restaurantId/combos/:itemId",
    checkPermission(DishPermissionEnum.AVAILABILITY),
    validate(updateRestaurantMenuItemSchema),
    restrictToRestaurant,
    auditRoute("restaurant_menu.combo_update", "combo", { entityId: (r) => r.params.itemId }),
    menuController.updateRestaurantCombo,
);

export default router;
