import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { tooManyRequestsResponse } from "~/common/responses/error";

const MINUTE = 60 * 1000;

/** Tắt bằng RATE_LIMIT_DISABLED=true (bộ test bật sẵn, vì test gọi đăng nhập rất nhiều lần từ cùng một IP) */
const disabled = () => process.env.RATE_LIMIT_DISABLED === "true";

const limiter = (windowMinutes: number, limit: number) =>
    rateLimit({
        windowMs: windowMinutes * MINUTE,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skip: disabled,
        handler: (req: Request, res: Response) => {
            tooManyRequestsResponse(res, req.t("auth:too_many_requests"));
        },
    });

/**
 * Giới hạn theo IP cho đăng nhập. Bổ sung cho cơ chế khóa theo tài khoản (5 lần sai / 15 phút):
 * chặn việc dò nhiều username khác nhau từ một nơi.
 */
export const loginRateLimit = limiter(15, 30);

/** Đăng ký, quên mật khẩu, xác nhận OTP, đặt lại mật khẩu: gửi mail / dò OTP nên chặt hơn */
export const sensitiveAuthRateLimit = limiter(15, 10);

/** Giai đoạn 13: API công khai có ghi dữ liệu (đặt bàn, gọi món QR, phản hồi) */
export const publicWriteRateLimit = limiter(15, 30);
