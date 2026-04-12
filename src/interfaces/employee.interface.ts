import { EmployeeStatusEnum, GenderEnum } from "../common/enum";

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
    account_id: number | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
