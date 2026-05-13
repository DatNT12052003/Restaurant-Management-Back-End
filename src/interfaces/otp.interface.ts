import { OTPTypeEnum } from "~/common/enum";

export interface IOtp {
    id: number;
    hash_code: string;
    type: OTPTypeEnum;
    expires_at: Date;
    is_used: boolean;
    account_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateOtpPayload extends Pick<IOtp, "hash_code" | "type" | "expires_at" | "account_id"> {}

export interface ICreateOTPBody extends Omit<ICreateOtpPayload, "hash_code"> {
    code: string;
}

export interface ISendOtpBody {
    account_id: number;
    type: OTPTypeEnum;
}

export interface IGetActiveOtp {
    account_id: number;
    type: OTPTypeEnum;
}
