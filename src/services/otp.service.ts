import { ICreateOTPBody, ICreateOtpPayload, IGetActiveOtp, IOtp } from "~/interfaces";
import bcrypt from "bcrypt";
import { otpRepository } from "~/repositories";

export const createOTP = async (body: ICreateOTPBody): Promise<IOtp | null> => {
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
        return null;
    }
};

export const getActiveOTP = async (payload: IGetActiveOtp): Promise<IOtp | null> => {
    try {
        const activeOtp = await otpRepository.getActiveOtpByAccountIdAndType(payload);
        return activeOtp;
    } catch (error) {
        return null;
    }
};

export const verifyOTP = async (otp: IOtp, code: string): Promise<boolean> => {
    try {
        const isValid = bcrypt.compareSync(code, otp.hash_code);
        return isValid;
    } catch (error) {
        return false;
    }
};

export const markOTPAsUsed = async (id: number): Promise<boolean> => {
    try {
        await otpRepository.markOtpAsUsed(id);
        return true;
    } catch (error) {
        return false;
    }
};
