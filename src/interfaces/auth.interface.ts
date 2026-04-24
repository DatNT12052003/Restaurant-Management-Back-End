import { ICreateAccountPayload } from "./account.interface";
import { IUser } from "./user.interface";

export interface ILoginPayload extends ICreateAccountPayload {}

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

export interface IJwtPayload {
    account_id: number;
    username: string;
}
