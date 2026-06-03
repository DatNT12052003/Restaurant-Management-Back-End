import { IPagination } from "./common.interface";

export interface IRoom {
    id: number;
    name: string;
    type: string;
    description?: string | null;
    status: string;
    restaurant_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface IGetRooms {
    rooms: Partial<IRoom>[];
    pagination: IPagination;
}
