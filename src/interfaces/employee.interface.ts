import { EmployeeStatusEnum, GenderEnum } from "../common/enum";
import { ICreateAccountPayload } from "./account.interface";

export interface IEmployee {
    id: number;
    full_name: string;
    date_of_birth: Date | null;
    gender: GenderEnum | null;
    address: string | null;
    email: string | null;
    phone_number: string | null;
    avatar_url: string | null;
    status: EmployeeStatusEnum;
    account_id?: number | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ICreateEmployeePayload extends Partial<
    Omit<IEmployee, "id" | "created_at" | "updated_at" | "deleted_at">
> {}

export interface ICreateEmployeeWithAccountPayload {
    employee: ICreateEmployeePayload;
    account: ICreateAccountPayload;
}
