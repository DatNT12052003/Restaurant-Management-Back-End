import { Router } from "express";
import { AccountPermissionEnum } from "~/common/permission-enum";
import { accountController } from "~/controllers";
import { authMiddleware, checkPermission, validate, validateCreate } from "~/middlewares";
import { createAccountSchema } from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", checkPermission(AccountPermissionEnum.VIEW), accountController.getAccounts);
router.post(
    "/",
    checkPermission(AccountPermissionEnum.CREATE),
    validateCreate,
    validate(createAccountSchema),
    accountController.createAccount,
);
router.put("/:id", checkPermission(AccountPermissionEnum.UPDATE), accountController.updateAccount);
router.delete("/:id", checkPermission(AccountPermissionEnum.DELETE), accountController.deleteAccount);

export default router;
