import { IPagination } from "./common.interface";

export interface IAccount {
    id: number;
    username: string;
    hash_password: string;
    /** Số lần đăng nhập sai trong cửa sổ hiện tại (xem `LOGIN_WINDOW_MINUTES`) */
    failed_login_count?: number;
    first_failed_at?: Date | null;
    /** Bị khóa tới thời điểm này do đăng nhập sai nhiều lần */
    locked_until?: Date | null;
    last_login_at?: Date | null;
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

export interface IChangePasswordBody {
    current_password: string;
    new_password: string;
    confirm_password: string;
}

/** Một dòng trên trang Tài khoản */
export interface IAccountListItem {
    id: number;
    username: string;
    last_login_at: Date | null;
    locked_until: Date | null;
    is_locked: boolean;
    failed_login_count: number;
    created_at: Date;
    user_id: number;
    full_name: string;
    user_status: string;
    restaurant_id: number | null;
    restaurant_name: string | null;
    roles: string[];
}

export interface IGetAccountList {
    accounts: IAccountListItem[];
    pagination: IPagination;
}

export interface IResetAccountPasswordBody {
    new_password: string;
    confirm_password: string;
}
