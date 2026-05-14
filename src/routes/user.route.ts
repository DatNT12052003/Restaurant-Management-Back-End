import { Router } from "express";
import { userController } from "~/controllers";
import { uploadAvatar, validate, validateCreate } from "~/middlewares";
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
router.get("/with-account-info", userController.getUsersWithAccountInfo);

export default router;
