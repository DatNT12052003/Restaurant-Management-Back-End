import { Router } from "express";
import { RestaurantPermissionEnum } from "~/common/permission-enum";
import { restaurantController } from "~/controllers";
import { authMiddleware, checkPermission } from "~/middlewares";

const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(RestaurantPermissionEnum.VIEW), restaurantController.getRestaurants);
// Danh sách rút gọn (id, name, ...) cho bộ chọn chi nhánh: mọi người dùng đã đăng nhập đều được xem
router.get("/all", restaurantController.getAllRestaurants);

export default router;
