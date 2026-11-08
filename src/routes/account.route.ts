import { Router } from "express";
import { AccountPermissionEnum } from "~/common/permission-enum";
import { accountController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, validate, validateCreate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { createAccountSchema } from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(AccountPermissionEnum.VIEW), accountController.getAccounts);
router.post(
    "/",
    checkPermission(AccountPermissionEnum.CREATE),
    validateCreate,
    validate(createAccountSchema),
    auditRoute("account.create", "account", { restaurantId: () => null }),
    accountController.createAccount,
);
router.put(
    "/:id",
    checkPermission(AccountPermissionEnum.UPDATE),
    auditRoute("account.update", "account", { before: AUDIT_BEFORE.account, restaurantId: () => null }),
    accountController.updateAccount,
);
router.delete(
    "/:id",
    checkPermission(AccountPermissionEnum.DELETE),
    auditRoute("account.delete", "account", { before: AUDIT_BEFORE.account, restaurantId: () => null, isDelete: true }),
    accountController.deleteAccount,
);

export default router;
