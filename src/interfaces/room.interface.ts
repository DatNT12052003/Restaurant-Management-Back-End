import { RoomTypeEnum, UsageStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface IRoom {
    id: number;
    name: string;
    type: RoomTypeEnum;
    description?: string | null;
    /** Trạng thái sử dụng */
    status: UsageStatusEnum;
    /** false = phòng tạm khóa */
    is_active: boolean;
    restaurant_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
    /** Số bàn trong phòng (có khi truy vấn kèm) */
    table_count?: number;
}

export interface IGetRooms {
    rooms: Partial<IRoom>[];
    pagination: IPagination;
}

export interface ICreateRoomBody {
    name: string;
    type: RoomTypeEnum;
    description?: string | null;
    status?: UsageStatusEnum;
    is_active?: boolean;
    restaurant_id: number;
}

export interface IUpdateRoomBody extends Partial<ICreateRoomBody> {}
