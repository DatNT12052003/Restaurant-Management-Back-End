import jwt from "jsonwebtoken";
import { IJwtPayload } from "~/interfaces";

const { ACCESS_SECRET, REFRESH_SECRET } = process.env;

const accessSecret = ACCESS_SECRET || "default_access_secret";
const refreshSecret = REFRESH_SECRET || "default_refresh_secret";

export const signAccessToken = (payload: IJwtPayload) => {
    return jwt.sign(payload, accessSecret, {
        expiresIn: "15m",
    });
};

export const signRefreshToken = (user_id: number) => {
    return jwt.sign({ user_id }, refreshSecret, {
        expiresIn: "7d",
    });
};

export const verifyAccessToken = (token: string) => jwt.verify(token, accessSecret) as IJwtPayload;

export const verifyRefreshToken = (token: string) => jwt.verify(token, refreshSecret) as IJwtPayload;
