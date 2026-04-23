import { ICreateAccountPayload } from "./account.interface";

export interface ILoginPayload extends ICreateAccountPayload {}

export interface IAuth {
    id: number;
    username: string;
    access_token: string;
    refresh_token: string;
}

export interface IJwtPayload {
    id: number;
    username: string;
    roles?: string[];
    permissions?: string[];
}
