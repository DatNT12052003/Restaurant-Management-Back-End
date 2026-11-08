import { Router } from "express";
import { DiscountPermissionEnum } from "~/common/permission-enum";
import { discountController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
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
    auditRoute("discount.create", "discount"),
    discountController.createDiscount,
);
router.patch(
    "/:id",
    checkPermission(DiscountPermissionEnum.UPDATE),
    validate(updateDiscountSchema),
    restrictToRestaurant,
    auditRoute("discount.update", "discount", { before: AUDIT_BEFORE.discount }),
    discountController.updateDiscount,
);
router.delete(
    "/:id",
    checkPermission(DiscountPermissionEnum.DELETE),
    validate(discountIdSchema),
    restrictToRestaurant,
    auditRoute("discount.delete", "discount", { before: AUDIT_BEFORE.discount, isDelete: true }),
    discountController.deleteDiscount,
);

export default router;
