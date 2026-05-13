import { IPagination } from "./common.interface";

export interface IRestaurant {
    id: number;
    name: string;
    status: string;
    address: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface IGetRestaurants {
    accounts: Partial<IRestaurant>[];
    pagination: IPagination;
}
