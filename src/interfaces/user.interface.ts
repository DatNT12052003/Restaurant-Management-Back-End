import { UserStatusEnum, GenderEnum } from "../common/enum";
import { ICreateAccountPayload } from "./account.interface";

export interface IUser {
    id: number;
    full_name: string;
    date_of_birth: Date | null;
    gender: GenderEnum | null;
    address: string | null;
    email: string | null;
    phone_number: string | null;
    avatar_url: string | null;
    status: UserStatusEnum;
    account_id?: number | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateUserPayload extends Partial<
    Omit<IUser, "id" | "date_of_birth" | "created_at" | "updated_at" | "deleted_at">
> {
    date_of_birth?: string | null;
}

export interface ICreateUserWithAccountPayload {
    user: ICreateUserPayload;
    account: ICreateAccountPayload;
}
