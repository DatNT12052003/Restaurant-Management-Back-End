import jwt from "jsonwebtoken";
import { IJwtAccountPayload, IJwtResetPasswordPayload } from "~/interfaces";

const { ACCESS_SECRET, REFRESH_SECRET, RESET_PASSWORD_SECRET } = process.env;

const accessSecret = ACCESS_SECRET || "default_access_secret";
const refreshSecret = REFRESH_SECRET || "default_refresh_secret";
const resetPasswordSecret = RESET_PASSWORD_SECRET || "default_reset_password_secret";

export const signAccessToken = (payload: IJwtAccountPayload) => {
    return jwt.sign(payload, accessSecret, {
        expiresIn: "15m",
    });
};

export const signRefreshToken = (payload: IJwtAccountPayload) => {
    return jwt.sign(payload, refreshSecret, {
        expiresIn: "7d",
    });
};

export const signResetPasswordToken = (payload: IJwtResetPasswordPayload) => {
    return jwt.sign(payload, resetPasswordSecret, {
        expiresIn: "5m",
    });
};

export const verifyAccessToken = (token: string) => jwt.verify(token, accessSecret) as IJwtAccountPayload;

export const verifyRefreshToken = (token: string) => jwt.verify(token, refreshSecret) as IJwtAccountPayload;

export const verifyResetPasswordToken = (token: string) =>
    jwt.verify(token, resetPasswordSecret) as IJwtResetPasswordPayload;
