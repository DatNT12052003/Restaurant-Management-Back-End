import { Router } from "express";
import { userController } from "~/controllers";
import { uploadAvatar, validate, validateCreate, validateUpdate, validateUpdateUser } from "~/middlewares";
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
router.patch("/:id", uploadAvatar, userController.updateUser);
router.patch("/delete/:id", userController.deleteUser);
router.get("/employees/:restaurant_id", userController.getEmployeesByRestaurantId);

export default router;
