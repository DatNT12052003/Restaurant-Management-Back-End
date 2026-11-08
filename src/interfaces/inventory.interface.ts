import { IngredientStatusEnum, InventoryReceiptTypeEnum, InventoryTransactionTypeEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

export interface IIngredient {
    id: number;
    name: string;
    unit: string;
    description: string | null;
    status: IngredientStatusEnum;
    created_at: Date;
    updated_at: Date;
}

export interface IIngredientBody {
    name?: string;
    unit?: string;
    description?: string | null;
    status?: IngredientStatusEnum;
}

/** Một dòng tồn kho của nhà hàng (nguyên liệu chưa có dòng inventory -> số lượng 0) */
export interface IStockItem {
    ingredient_id: number;
    name: string;
    unit: string;
    status: IngredientStatusEnum;
    /** numeric -> chuỗi */
    quantity: string;
    min_quantity: string;
    avg_unit_cost: string;
    /** quantity × avg_unit_cost */
    stock_value: string;
    is_low: boolean;
    last_change_at: Date | null;
}

export interface IStock {
    restaurant_id: number;
    items: IStockItem[];
    summary: { total_value: string; low_count: number; item_count: number };
}

export interface IInventoryRow {
    restaurant_id: number;
    ingredient_id: number;
    quantity: string;
    min_quantity: string;
    avg_unit_cost: string;
}

export interface IReceiptLineBody {
    ingredient_id: number;
    /** Nhập / xuất: số lượng (> 0); kiểm kê: số thực tế đếm được (>= 0) */
    quantity: number;
    /** Chỉ phiếu nhập */
    unit_price?: number;
    note?: string | null;
}

export interface ICreateReceiptBody {
    restaurant_id?: number;
    type: InventoryReceiptTypeEnum;
    supplier?: string | null;
    reason?: string | null;
    note?: string | null;
    lines: IReceiptLineBody[];
}

export interface IInventoryTransaction {
    id: number;
    restaurant_id: number;
    ingredient_id: number;
    ingredient_name?: string;
    unit?: string;
    receipt_id: number | null;
    receipt_code?: string | null;
    type: InventoryTransactionTypeEnum;
    quantity_change: string;
    quantity_after: string;
    unit_price: string;
    reason: string | null;
    created_by: number | null;
    created_by_name?: string | null;
    created_at: Date;
}

export interface IInventoryReceipt {
    id: number;
    code: string;
    restaurant_id: number;
    type: InventoryReceiptTypeEnum;
    supplier: string | null;
    reason: string | null;
    note: string | null;
    total_value: string;
    created_by: number | null;
    created_by_name?: string | null;
    line_count?: number;
    created_at: Date;
    lines?: IInventoryTransaction[];
}

export interface IGetReceipts {
    receipts: IInventoryReceipt[];
    pagination: IPagination;
}

export interface IGetInventoryTransactions {
    transactions: IInventoryTransaction[];
    pagination: IPagination;
}
