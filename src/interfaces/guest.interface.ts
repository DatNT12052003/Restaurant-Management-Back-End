import { GenderEnum, GuestStatusEnum } from "../common/enum";
import { IAccount } from "~/interfaces/index";

export interface IGuest {
    id: number;
    full_name: string;
    avatar_url: string | null;
    gender: GenderEnum | null;
    phone_number: string | null;
    email: string | null;
    address: string | null;
    status: GuestStatusEnum;
    account_id: number | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateGuestPayload extends Partial<Omit<IGuest, "id" | "created_at" | "updated_at" | "deleted_at">> {}
