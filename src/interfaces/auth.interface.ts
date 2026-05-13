import { ICreateAccountBody } from "./account.interface";
import { IUser } from "./user.interface";

export interface ILoginBody extends ICreateAccountBody {}

export interface IAuth {
    account_id: number;
    username: string;
    access_token: string;
    refresh_token: string;
}

export interface IMe {
    account_id: number;
    username: string;
    user: IUser;
    roles: string[];
    permissions: string[];
}

export interface IJwtAccountPayload {
    account_id: number;
    username: string;
    jti?: string;
}

export interface IJwtResetPasswordPayload {
    account_id: number;
}
