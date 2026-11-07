import { UserStatusEnum, GenderEnum, GuestStatusEnum } from "../common/enum";
import { ICreateAccountBody, ICreateAccountPayload, IUpdateUsernameBody } from "./account.interface";
import { IPagination } from "./common.interface";

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
    account_id: number | null;
    restaurant_id: number | null;
    /** Mức lương (nhân viên). pg trả numeric dưới dạng chuỗi. */
    salary: string | number | null;
    /** Trạng thái khách (chỉ với guest) */
    guest_status: GuestStatusEnum | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface IUserWithAccount extends IUser {
    username: string;
}

export interface IEmployee {
    employee: IUserWithAccount;
    roles: string[];
    permissions: string[];
}

export interface IGetEmployees {
    employees: IEmployee[];
    pagination: IPagination;
}

export interface ICreateEmployeeBody extends ICreateUserWithAccountBody {
    roles: string[];
}

export interface IUpdateEmployeeBody {
    user: IUpdateUserBody;
    account?: Partial<IUpdateUsernameBody>;
    /** Không truyền = giữ nguyên vai trò */
    roles?: string[];
}

export interface IGuest extends IUserWithAccount {}

export interface ICreateGuestBody extends ICreateUserWithAccountBody {}

export interface IGetGuests {
    guests: IGuest[];
    pagination: IPagination;
}

export interface IUpdateGuestBody extends Omit<IUpdateEmployeeBody, "roles"> {}

export interface ICreateUserBody extends Omit<
    IUser,
    "id" | "status" | "date_of_birth" | "created_at" | "updated_at" | "deleted_at" | "salary" | "guest_status"
> {
    date_of_birth?: string | null;
    salary?: number | null;
    guest_status?: GuestStatusEnum | null;
}

export interface ICreateUserPayload extends Omit<
    IUser,
    "id" | "status" | "created_at" | "updated_at" | "deleted_at" | "salary" | "guest_status"
> {
    salary?: number | null;
    guest_status?: GuestStatusEnum | null;
}

export interface ICreateUserWithAccountBody {
    user: ICreateUserBody;
    account: ICreateAccountBody;
}

export interface IUpdateUserBody {
    full_name?: string;
    date_of_birth?: string | null;
    gender?: GenderEnum | null;
    address?: string | null;
    email?: string | null;
    phone_number?: string | null;
    avatar_url?: string | null;
    status?: UserStatusEnum;
    restaurant_id?: number | null;
    salary?: number | null;
    guest_status?: GuestStatusEnum | null;
}

export interface IUpdateUserPayload extends Omit<IUpdateUserBody, "date_of_birth"> {
    date_of_birth?: Date | null;
    updated_at?: Date;
}
