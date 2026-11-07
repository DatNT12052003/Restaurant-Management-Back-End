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
}

export interface IGetRooms {
    rooms: Partial<IRoom>[];
    pagination: IPagination;
}
