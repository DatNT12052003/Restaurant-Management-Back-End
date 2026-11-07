import { UsageStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface ITable {
    id: number;
    name: string;
    status: UsageStatusEnum;
    /** Số ghế */
    capacity: number;
    room_id: number;
    /** Có khi truy vấn join với rooms */
    restaurant_id?: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface IGetTables {
    tables: Partial<ITable>[];
    pagination: IPagination;
}

export interface ICreateTableBody {
    name: string;
    capacity?: number;
    status?: UsageStatusEnum;
    room_id: number;
}

export interface IUpdateTableBody extends Partial<ICreateTableBody> {}
