import { Router } from "express";
import { authController } from "~/controllers";
import { validate, validateLogin } from "~/middlewares";
import { authMiddleware } from "~/middlewares/auth.middleware";
import { loginSchema } from "~/schemas";

const router = Router();

router.post("/login", validateLogin, validate(loginSchema), authController.login);
router.get("/me", authMiddleware, authController.getMe);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAll);
router.post("/forgot-password", authController.forgotPassword);
router.post("/confirm-otp", authController.confirmOtp);
router.post("/reset-password", authController.resetPassword);

export default router;
