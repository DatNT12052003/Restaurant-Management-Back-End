import { IPagination } from "./common.interface";

export interface IAccount {
    id: number;
    username: string;
    hash_password: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateAccountBody {
    username: string;
    password: string;
}

export interface ICreateAccountPayload extends Pick<IAccount, "username" | "hash_password"> {}

export interface IGetAccounts {
    accounts: Partial<IAccount>[];
    pagination: IPagination;
}

export interface IUpdatePasswordBody {
    reset_password_token: string;
    new_password: string;
    confirm_password: string;
}

export interface IUpdatePasswordPayload {
    hash_password: string;
}

export interface IUpdateUsernameBody {
    username?: string;
}

export interface IUpdateUsernamePayload extends IUpdateUsernameBody {}
