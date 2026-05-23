import { Router } from "express";
import { userController } from "~/controllers";
import {
    authMiddleware,
    checkPermission,
    isSelfOrAdminOrManager,
    uploadAvatar,
    validate,
    validateCreate,
} from "~/middlewares";
import { createUserSchema, createUserWithAccountSchema } from "~/schemas";

const router = Router();

router.post("/", uploadAvatar, validateCreate, validate(createUserSchema), userController.createUser);
router.post(
    "/with-account",
    uploadAvatar,
    validateCreate,
    validate(createUserWithAccountSchema),
    userController.createUserWithAccount,
);
router.patch(
    "/:id",
    authMiddleware,
    checkPermission("employee.update"),
    isSelfOrAdminOrManager,
    uploadAvatar,
    userController.updateUser,
);
router.patch(
    "/delete/:id",
    authMiddleware,
    checkPermission("employee.delete"),
    isSelfOrAdminOrManager,
    userController.deleteUser,
);
router.get("/employees/:restaurant_id", userController.getEmployeesByRestaurantId);

router.post(
    "/employee",
    authMiddleware,
    checkPermission("employee.create"),
    isSelfOrAdminOrManager,
    // validate(createUserWithAccountSchema),
    uploadAvatar,
    userController.createEmployee,
);

export default router;
