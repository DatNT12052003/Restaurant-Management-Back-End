import { Router } from "express";
import { AccountPermissionEnum } from "~/common/permission-enum";
import { accountController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate, validateCreate } from "~/middlewares";
import { createAccountSchema, listAccountsSchema } from "~/schemas";

/**
 * Tài khoản đăng nhập. Thao tác trên tài khoản của một người (mở khóa, đăng xuất từ xa, đặt lại mật khẩu) nằm ở
 * `/api/users/:id/account/*` để dùng chung kiểm tra cấp bậc và chi nhánh (`canManageTargetUser`).
 */
const router = Router();

router.use(authMiddleware);

router.get(
    "/",
    checkPermission(AccountPermissionEnum.VIEW),
    validate(listAccountsSchema),
    restrictToRestaurant,
    accountController.getAccounts,
);
router.post(
    "/",
    checkPermission(AccountPermissionEnum.CREATE),
    validateCreate,
    validate(createAccountSchema),
    auditRoute("account.create", "account", { restaurantId: () => null }),
    accountController.createAccount,
);

export default router;
