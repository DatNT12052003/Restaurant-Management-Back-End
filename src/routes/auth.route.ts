import { Router } from "express";
import { authController } from "~/controllers";
import { validate, validateLogin } from "~/middlewares";
import { loginSchema } from "~/schemas";

const router = Router();

router.post("/login", validateLogin, validate(loginSchema), authController.login);

export default router;
