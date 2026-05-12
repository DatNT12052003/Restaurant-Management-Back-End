import { Request, Response } from "express";
import { badRequestResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse, loginSuccessResponse, successResponse } from "~/common/responses/success";
import { ICreateOTPBody, IJwtAccountPayload, ILoginBody, IUpdatePasswordBody, IUser } from "~/interfaces";
import { getMeResource } from "~/resources";
import { authService, mailService, otpService, tokenService, userService } from "~/services";
import { generateOTP } from "~/utils/common";

export const login = async (req: Request, res: Response) => {
    try {
        const body: ILoginBody = req.body;
        if (!body.username || !body.password) {
            return badRequestResponse(res, req.t("auth:username_password_required"));
        }

        const authData = await authService.login(body);

        if (!authData) {
            return badRequestResponse(res, req.t("auth:invalid_username_or_password"));
        }

        const platform = req.headers["x-platform"];

        if (platform === "web") {
            res.cookie("refresh_token", authData.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            return loginSuccessResponse(res, req.t("auth:login_successfully"), {
                account_id: authData.account_id,
                username: authData.username,
                access_token: authData.access_token,
            });
        }

        return loginSuccessResponse(res, req.t("auth:login_successfully"), authData);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getMe = async (req: Request, res: Response) => {
    try {
        const account_id = req.account?.account_id;
        const username = req.account?.username;
        if (!account_id || !username) {
            return badRequestResponse(res, req.t("auth:invalid_token"));
        }
        const payload: IJwtAccountPayload = { account_id, username };
        const meData = await authService.getMe(payload);
        if (!meData) {
            return badRequestResponse(res, req.t("auth:user_not_found"));
        }
        return getSuccessResponse(res, req.t("auth:get_me_successfully"), getMeResource(meData));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const refreshToken = async (req: Request, res: Response) => {
    try {
        const refresh_token: string = req.cookies?.refresh_token || req.body?.refresh_token;
        if (!refresh_token) {
            return badRequestResponse(res, req.t("auth:refresh_token_required"));
        }
        const authData = await authService.refreshToken(refresh_token);
        if (!authData) {
            return badRequestResponse(res, req.t("auth:invalid_refresh_token"));
        }
        const platform = req.headers["x-platform"];

        if (platform === "web") {
            res.cookie("refresh_token", authData.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });
            return loginSuccessResponse(res, req.t("auth:refresh_token_successfully"), {
                account_id: authData.account_id,
                username: authData.username,
                access_token: authData.access_token,
            });
        }

        return loginSuccessResponse(res, req.t("auth:refresh_token_successfully"), authData);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const logout = async (req: Request, res: Response) => {
    try {
        const refresh_token: string = req.cookies?.refresh_token || req.body?.refresh_token;
        if (!refresh_token) {
            return badRequestResponse(res, req.t("auth:refresh_token_required"));
        }
        const result = await authService.logout(refresh_token);
        if (!result) {
            return badRequestResponse(res, req.t("auth:invalid_refresh_token"));
        }
        const platform = req.headers["x-platform"];

        if (platform === "web") {
            res.clearCookie("refresh_token", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
            });
        }

        return getSuccessResponse(res, req.t("auth:logout_successfully"), null);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const logoutAll = async (req: Request, res: Response) => {
    try {
        const account_id = req.account?.account_id;
        if (!account_id) {
            return badRequestResponse(res, req.t("auth:invalid_token"));
        }
        const result = await authService.logoutAll(account_id);
        if (!result) {
            return badRequestResponse(res, req.t("auth:error_logging_out"));
        }

        const platform = req.headers["x-platform"];

        if (platform === "web") {
            res.clearCookie("refresh_token", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
            });
        }

        return getSuccessResponse(res, req.t("auth:logout_all_successfully"), null);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const { email, type } = req.body;
        const otp = generateOTP();
        const expires_at = new Date(Date.now() + 60 * 1000);
        if (!email || !type || !expires_at) {
            return badRequestResponse(res, req.t("auth:email_type_expires_at_required"));
        }

        const user = await userService.getUserByEmail(email);
        if (!user) {
            return badRequestResponse(res, req.t("auth:user_not_found"));
        }

        if (!user.email) {
            return badRequestResponse(res, req.t("auth:user_email_not_found"));
        }

        if (!user.account_id) {
            return badRequestResponse(res, req.t("auth:user_account_not_found"));
        }

        const createOtpBody: ICreateOTPBody = { code: otp, type, expires_at, account_id: user.account_id };

        const mailResult = await mailService.sendMail({
            to: user.email,
            subject: "Your OTP Code",
            html: `<p>Your OTP code is: <strong>${otp}</strong>. It will expire in 1 minute.</p>`,
        });
        if (!mailResult) {
            return badRequestResponse(res, req.t("auth:error_sending_otp_email"));
        }

        const saveOtpResult = await otpService.createOTP(createOtpBody);
        if (!saveOtpResult) {
            return badRequestResponse(res, req.t("auth:error_saving_otp"));
        }

        return successResponse(res, req.t("auth:otp_sent_successfully"), { account_id: user.account_id });
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const confirmOtp = async (req: Request, res: Response) => {
    try {
        const { account_id, code, type } = req.body;
        const otpRecord = await otpService.getActiveOTP({ account_id, type });
        if (!otpRecord) {
            return badRequestResponse(res, req.t("auth:invalid_or_expired_otp"));
        }
        const isCodeValid = await otpService.verifyOTP(otpRecord, code);
        if (!isCodeValid) {
            return badRequestResponse(res, req.t("auth:invalid_or_expired_otp"));
        }
        const markAsUsedResult = await otpService.markOTPAsUsed(otpRecord.id);
        if (!markAsUsedResult) {
            return badRequestResponse(res, req.t("auth:error_marking_otp_as_used"));
        }

        const resetPasswordToken = await tokenService.createResetPasswordToken({ account_id });
        if (!resetPasswordToken) {
            return badRequestResponse(res, req.t("auth:error_creating_reset_password_token"));
        }

        return successResponse(res, req.t("auth:otp_verified_successfully"), {
            reset_password_token: resetPasswordToken,
        });
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const body: IUpdatePasswordBody = req.body;
        if (!body.reset_password_token || !body.new_password || !body.confirm_password) {
            return badRequestResponse(res, req.t("auth:reset_password_token_new_password_confirm_password_required"));
        }
        const result = await authService.resetPassword(body);
        if (!result) {
            return badRequestResponse(res, req.t("auth:invalid_or_expired_reset_password_token"));
        }
        return successResponse(res, req.t("auth:password_reset_successfully"));
    } catch (error) {
        return serverErrorResponse(res);
    }
};
