import { DishCategoryEnum, ImageEntityEnum, MenuItemStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface ITag {
    id: number;
    name: string;
    /** Số món đang gắn thẻ (có khi lấy danh sách) */
    dish_count?: number;
}

export interface IDish {
    id: number;
    name: string;
    description: string | null;
    /** pg trả numeric dưới dạng chuỗi */
    price: string;
    category: DishCategoryEnum;
    status: MenuItemStatusEnum;
    created_at: Date;
    updated_at: Date;
    /** Ảnh đại diện (subquery) */
    image_url?: string | null;
    tags?: ITag[];
}

export interface IGetDishes {
    dishes: IDish[];
    pagination: IPagination;
}

export interface IDishBody {
    name?: string;
    description?: string | null;
    price?: number;
    category?: DishCategoryEnum;
    status?: MenuItemStatusEnum;
    /** Thay thế toàn bộ thẻ của món; không truyền = giữ nguyên */
    tag_ids?: number[];
}

export interface IComboItem {
    dish_id: number;
    quantity: number;
    name?: string;
    price?: string;
    status?: MenuItemStatusEnum;
}

export interface ICombo {
    id: number;
    name: string;
    description: string | null;
    price: string;
    status: MenuItemStatusEnum;
    created_at: Date;
    updated_at: Date;
    image_url?: string | null;
    items?: IComboItem[];
    /** Tổng giá gốc các món trong combo (để hiển thị mức tiết kiệm) */
    items_total?: string;
}

export interface IGetCombos {
    combos: ICombo[];
    pagination: IPagination;
}

export interface IComboBody {
    name?: string;
    description?: string | null;
    price?: number;
    status?: MenuItemStatusEnum;
    /** Thay thế toàn bộ món trong combo; không truyền = giữ nguyên */
    items?: { dish_id: number; quantity: number }[];
}

/** Một món / combo trong thực đơn của một nhà hàng */
export interface IRestaurantMenuItem {
    id: number;
    name: string;
    status: MenuItemStatusEnum;
    category?: DishCategoryEnum;
    image_url: string | null;
    base_price: string;
    /** Giá riêng của nhà hàng; null = dùng giá gốc */
    override_price: string | null;
    /** Giá thực tế đang bán */
    price: string;
    is_available: boolean;
}

export interface IRestaurantMenu {
    restaurant_id: number;
    dishes: IRestaurantMenuItem[];
    combos: IRestaurantMenuItem[];
}

export interface IRestaurantMenuItemBody {
    is_available?: boolean;
    /** null = bỏ giá riêng */
    price?: number | null;
}

export interface IImage {
    id: number;
    url: string;
    public_id: string | null;
    entity_type: ImageEntityEnum;
    entity_id: number;
    is_primary: boolean;
    sort_order: number;
    created_at: Date;
}
