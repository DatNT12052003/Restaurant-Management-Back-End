import { Router } from "express";
import { RestaurantPermissionEnum } from "~/common/permission-enum";
import { restaurantController } from "~/controllers";
import { authMiddleware, checkPermission, loadUserContext, restrictToRestaurant, validate } from "~/middlewares";
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
    restaurantController.createRestaurant,
);
router.patch(
    "/:id",
    checkPermission(RestaurantPermissionEnum.UPDATE),
    validate(updateRestaurantSchema),
    restaurantController.updateRestaurant,
);
router.delete(
    "/:id",
    checkPermission(RestaurantPermissionEnum.DELETE),
    validate(restaurantIdSchema),
    restaurantController.deleteRestaurant,
);

export default router;
