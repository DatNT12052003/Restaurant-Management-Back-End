import { Router } from "express";
import { authController } from "~/controllers";
import { authMiddleware, uploadAvatar, validate, validateCreate, validateLogin } from "~/middlewares";
import { changePasswordSchema, loginSchema } from "~/schemas";

const router = Router();

router.post("/register", uploadAvatar, validateCreate, authController.register);
router.post("/login", validateLogin, validate(loginSchema), authController.login);
router.get("/me", authMiddleware, authController.getMe);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAll);
router.post("/forgot-password", authController.forgotPassword);
router.post("/confirm-otp", authController.confirmOtp);
router.post("/reset-password", authController.resetPassword);
router.post("/change-password", authMiddleware, validate(changePasswordSchema), authController.changePassword);

export default router;
