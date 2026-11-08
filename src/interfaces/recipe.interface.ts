import { DishCategoryEnum, MenuItemStatusEnum } from "~/common/enum";
import { OrderLineKind } from "./order.interface";

/** Một nguyên liệu trong định lượng món (cho 1 phần) */
export interface IRecipeItem {
    ingredient_id: number;
    name: string;
    unit: string;
    quantity: string;
    /** Giá vốn bình quân hiện tại của nguyên liệu (theo nhà hàng đang xem) */
    unit_cost: string;
    /** quantity × unit_cost */
    cost: string;
    ingredient_status: string;
}

export interface IDishRecipe {
    dish_id: number;
    name: string;
    /** Giá bán (giá chi nhánh nếu có) */
    price: string;
    items: IRecipeItem[];
    /** Giá vốn lý thuyết của 1 phần theo giá bình quân hiện tại */
    cost: number;
    /** Tỷ lệ giá vốn / giá bán (0–1), null khi giá bán = 0 */
    food_cost_rate: number | null;
}

export interface IRecipeBody {
    items: { ingredient_id: number; quantity: number }[];
}

/** Một món / combo trong bảng giá vốn */
export interface IMenuCostRow {
    kind: OrderLineKind;
    id: number;
    name: string;
    category: DishCategoryEnum | "combo";
    status: MenuItemStatusEnum;
    price: number;
    /** null = chưa có định lượng (combo: có món bên trong chưa có định lượng) */
    cost: number | null;
    margin: number | null;
    food_cost_rate: number | null;
    ingredient_count: number;
}

export interface IMenuCosts {
    restaurant_id: number | null;
    items: IMenuCostRow[];
    summary: { items: number; missing_recipe: number; avg_food_cost_rate: number | null };
}

/** Dòng món vừa phục vụ, cần trừ kho */
export interface IServedLine {
    kind: OrderLineKind;
    id: number;
    restaurant_id: number;
}

/** Kết quả trừ kho, dùng để phát `inventory:changed` sau commit */
export interface IConsumeResult {
    restaurant_id: number;
    ingredient_ids: number[];
    low_ingredient_ids: number[];
}

export interface IClosedDay {
    restaurant_id: number;
    day: string;
    note: string | null;
    created_by: number | null;
    created_by_name?: string | null;
    created_at: Date;
}
