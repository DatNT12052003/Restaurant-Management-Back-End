import { RestaurantStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface IRestaurant {
    id: number;
    name: string;
    status: RestaurantStatusEnum;
    address: string;
    /** Phí dịch vụ và thuế (%) áp cho order mới */
    service_fee_percent: string;
    tax_percent: string;
    /** Giờ mở / đóng cửa ("HH:mm:ss"), dùng tính tỷ lệ lấp đầy bàn. Đóng <= mở nghĩa là mở qua đêm. */
    open_time: string;
    close_time: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface IGetRestaurants {
    restaurants: Partial<IRestaurant>[];
    pagination: IPagination;
}

export interface ICreateRestaurantBody {
    name: string;
    address: string;
    status?: RestaurantStatusEnum;
    service_fee_percent?: number;
    tax_percent?: number;
    open_time?: string;
    close_time?: string;
}

export interface IUpdateRestaurantBody extends Partial<ICreateRestaurantBody> {}
