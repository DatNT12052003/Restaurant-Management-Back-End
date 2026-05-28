import { ICreateOTPBody, ICreateOtpPayload, IGetActiveOtp, IOtp } from "~/interfaces";
import bcrypt from "bcrypt";
import { otpRepository } from "~/repositories";
import { signResetPasswordToken } from "~/utils/jwt";
import { CREATE_OTP, GET_ACTIVE_OTP, MARK_OTP_AS_USED, VERIFY_OTP } from "~/common/error-code/otp";

export const createOTP = async (body: ICreateOTPBody): Promise<IOtp | number> => {
    try {
        const hash_code = bcrypt.hashSync(body.code, 10);
        const otpData: ICreateOtpPayload = {
            hash_code,
            type: body.type,
            expires_at: body.expires_at,
            account_id: body.account_id,
        };
        const newOtp = await otpRepository.createOtp(otpData);
        return newOtp;
    } catch (error) {
        return CREATE_OTP.CREATE_OTP_FAILED;
    }
};

export const getActiveOTP = async (payload: IGetActiveOtp): Promise<IOtp | number> => {
    try {
        const activeOtp = await otpRepository.getActiveOtpByAccountIdAndType(payload);
        if (!activeOtp) {
            return GET_ACTIVE_OTP.OTP_NOT_FOUND;
        }
        return activeOtp;
    } catch (error) {
        return GET_ACTIVE_OTP.GET_ACTIVE_OTP_FAILED;
    }
};

export const verifyOTP = async (otp: IOtp, code: string): Promise<boolean | number> => {
    try {
        const isValid = bcrypt.compareSync(code, otp.hash_code);
        return isValid;
    } catch (error) {
        return VERIFY_OTP.VERIFY_OTP_FAILED;
    }
};

export const markOTPAsUsed = async (id: number): Promise<number> => {
    try {
        await otpRepository.markOtpAsUsed(id);
        return MARK_OTP_AS_USED.MARK_OTP_AS_USED_SUCCESS;
    } catch (error) {
        return MARK_OTP_AS_USED.MARK_OTP_AS_USED_FAILED;
    }
};
