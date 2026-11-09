import { Router } from "express";
import { authController } from "~/controllers";
import {
    authMiddleware,
    loginRateLimit,
    sensitiveAuthRateLimit,
    uploadAvatar,
    validate,
    validateCreate,
    validateLogin,
} from "~/middlewares";
import { changePasswordSchema, createGuestSchema, loginSchema } from "~/schemas";

const router = Router();

// Khách tự đăng ký (multipart vì có ảnh đại diện): validate sau multer
router.post("/register", sensitiveAuthRateLimit, uploadAvatar, validateCreate, validate(createGuestSchema), authController.register);
router.post("/login", loginRateLimit, validateLogin, validate(loginSchema), authController.login);
router.get("/me", authMiddleware, authController.getMe);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAll);
router.post("/forgot-password", sensitiveAuthRateLimit, authController.forgotPassword);
router.post("/confirm-otp", sensitiveAuthRateLimit, authController.confirmOtp);
router.post("/reset-password", sensitiveAuthRateLimit, authController.resetPassword);
router.post("/change-password", authMiddleware, validate(changePasswordSchema), authController.changePassword);

export default router;
