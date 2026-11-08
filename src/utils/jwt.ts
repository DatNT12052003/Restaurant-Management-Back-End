import jwt from "jsonwebtoken";
import { IJwtAccountPayload } from "~/interfaces";

type SecretName = "ACCESS_SECRET" | "REFRESH_SECRET" | "RESET_PASSWORD_SECRET";

/**
 * Đọc secret lúc dùng (không đọc lúc import, để không phụ thuộc thứ tự nạp .env).
 * Production bắt buộc phải cấu hình; môi trường dev / test mới được dùng giá trị mặc định.
 */
const secret = (name: SecretName): string => {
    const value = process.env[name];
    if (value) return value;
    if (process.env.NODE_ENV === "production") throw new Error(`Missing ${name}`);
    return `default_${name.toLowerCase()}`;
};

/** Gọi khi khởi động: production thiếu secret thì dừng ngay thay vì lỗi ở request đầu tiên */
export const assertJwtSecrets = () => {
    for (const name of ["ACCESS_SECRET", "REFRESH_SECRET", "RESET_PASSWORD_SECRET"] as const) secret(name);
};

export const signAccessToken = (payload: IJwtAccountPayload) => {
    return jwt.sign(payload, secret("ACCESS_SECRET"), {
        expiresIn: "15m",
    });
};

export const signRefreshToken = (payload: IJwtAccountPayload) => {
    return jwt.sign(payload, secret("REFRESH_SECRET"), {
        expiresIn: "7d",
    });
};

export const signResetPasswordToken = (payload: IJwtAccountPayload) => {
    return jwt.sign(payload, secret("RESET_PASSWORD_SECRET"), {
        expiresIn: "5m",
    });
};

export const verifyAccessToken = (token: string) => jwt.verify(token, secret("ACCESS_SECRET")) as IJwtAccountPayload;

export const verifyRefreshToken = (token: string) => jwt.verify(token, secret("REFRESH_SECRET")) as IJwtAccountPayload;

export const verifyResetPasswordToken = (token: string) => jwt.verify(token, secret("RESET_PASSWORD_SECRET")) as IJwtAccountPayload;
