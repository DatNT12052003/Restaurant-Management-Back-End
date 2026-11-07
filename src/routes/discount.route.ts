import { Router } from "express";
import { DiscountPermissionEnum } from "~/common/permission-enum";
import { discountController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { createDiscountSchema, discountIdSchema, listDiscountsSchema, updateDiscountSchema } from "~/schemas";

/**
 * Mã giảm giá (đặc tả 4.9). Mã có `restaurant_id = null` dùng cho cả chuỗi (chỉ admin tạo / sửa);
 * quản lý chi nhánh tạo mã cho nhà hàng của mình.
 */
const router = Router();

router.use(authMiddleware);

router.get(
    "/",
    checkPermission(DiscountPermissionEnum.VIEW),
    validate(listDiscountsSchema),
    restrictToRestaurant,
    discountController.getDiscounts,
);
router.get(
    "/:id",
    checkPermission(DiscountPermissionEnum.VIEW),
    validate(discountIdSchema),
    restrictToRestaurant,
    discountController.getDiscountById,
);
router.post(
    "/",
    checkPermission(DiscountPermissionEnum.CREATE),
    validate(createDiscountSchema),
    restrictToRestaurant,
    discountController.createDiscount,
);
router.patch(
    "/:id",
    checkPermission(DiscountPermissionEnum.UPDATE),
    validate(updateDiscountSchema),
    restrictToRestaurant,
    discountController.updateDiscount,
);
router.delete(
    "/:id",
    checkPermission(DiscountPermissionEnum.DELETE),
    validate(discountIdSchema),
    restrictToRestaurant,
    discountController.deleteDiscount,
);

export default router;
