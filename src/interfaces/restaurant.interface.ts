import { RestaurantStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface IRestaurant {
    id: number;
    name: string;
    status: RestaurantStatusEnum;
    address: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface IGetRestaurants {
    restaurants: Partial<IRestaurant>[];
    pagination: IPagination;
}
