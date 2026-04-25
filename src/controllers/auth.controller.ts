import { Request, Response } from "express";
import { use } from "i18next";
import { badRequestResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse, loginSuccessResponse, successResponse } from "~/common/responses/success";
import { IJwtPayload, ILoginPayload, IUser } from "~/interfaces";
import { accountService, authService, mailService, otpService, userService } from "~/services";
import { generateOTP } from "~/utils/common";

export const login = async (req: Request, res: Response) => {
    try {
        const body: ILoginPayload = req.body;
        if (!body.username || !body.password) {
            return badRequestResponse(res, req.t("auth:username_password_required"));
        }

        const authData = await authService.login(body);

        if (!authData) {
            return badRequestResponse(res, req.t("auth:invalid_username_or_password"));
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
        const payload: IJwtPayload = { account_id, username };
        const meData = await authService.getMe(payload);
        if (!meData) {
            return badRequestResponse(res, req.t("auth:user_not_found"));
        }
        return getSuccessResponse(res, req.t("auth:get_me_successfully"), meData);
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
        return getSuccessResponse(res, req.t("auth:logout_all_successfully"), null);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const sendOtp = async (req: Request, res: Response) => {
    try {
        const { username, type } = req.body;
        const account = await accountService.getAccountByUsername(username);
        if (!account) {
            return badRequestResponse(res, req.t("auth:account_not_found"));
        }
        const user: IUser | null = await userService.getUserByAccountId(account?.id);
        if (!user) {
            return badRequestResponse(res, req.t("auth:user_not_found"));
        }
        const otp = generateOTP();
        const expires_at = new Date(Date.now() + 60 * 1000);
        if (!username || !account || !type || !expires_at) {
            return badRequestResponse(res, req.t("auth:username_type_expires_at_required"));
        }
        const createOtpPayload = { code: otp, type, expires_at, account_id: account.id };

        if (!user.email) {
            return badRequestResponse(res, req.t("auth:user_email_not_found"));
        }

        const mailResult = await mailService.sendMail({
            to: user.email,
            subject: "Your OTP Code",
            html: `<p>Your OTP code is: <strong>${otp}</strong>. It will expire in 1 minute.</p>`,
        });
        if (!mailResult) {
            return badRequestResponse(res, req.t("auth:error_sending_otp_email"));
        }

        const saveOtpResult = await otpService.createOTP(createOtpPayload);
        if (!saveOtpResult) {
            return badRequestResponse(res, req.t("auth:error_saving_otp"));
        }

        return successResponse(res, req.t("auth:otp_sent_successfully"));
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const { username, code, type } = req.body;
        const account = await accountService.getAccountByUsername(username);
        if (!account) {
            return badRequestResponse(res, req.t("auth:account_not_found"));
        }
        const otpRecord = await otpService.getActiveOTP({ account_id: account.id, type });
        if (!otpRecord) {
            return badRequestResponse(res, req.t("auth:invalid_or_expired_otp"));
        }
        const isCodeValid = await otpService.verifyOTP(otpRecord, code);
        if (!isCodeValid) {
            return badRequestResponse(res, req.t("auth:invalid_or_expired_otp"));
        }
        await otpService.markOTPAsUsed(otpRecord.id);
        return successResponse(res, req.t("auth:otp_verified_successfully"));
    } catch (error) {
        return serverErrorResponse(res);
    }
};
