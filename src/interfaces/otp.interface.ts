export interface IOtp {
    id: number;
    hash_code: string;
    type: "RESET_PASSWORD" | "VERIFY_EMAIL" | "LOGIN" | "CHANGE_EMAIL" | "TWO_FA";
    expires_at: Date;
    is_used: boolean;
    account_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateOtp extends Pick<IOtp, "hash_code" | "type" | "expires_at" | "account_id"> {}

export interface ICreateOTPPayload extends Omit<ICreateOtp, "hash_code"> {
    code: string;
}

export interface IGetActiveOtp {
    account_id: number;
    type: IOtp["type"];
}
