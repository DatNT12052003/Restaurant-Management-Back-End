import { IPagination } from "./common.interface";

export interface IAccount {
    id: number;
    username: string;
    hash_password: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateAccountPayload {
    username: string;
    password: string;
}

export interface ICreateAccount extends Pick<IAccount, "username" | "hash_password"> {}

export interface IGetAccounts {
    accounts: Partial<IAccount>[];
    pagination: IPagination;
}
