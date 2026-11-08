import {
    PaymentMethodEnum,
    PurchaseOrderStatusEnum,
    StockTransferStatusEnum,
    SupplierBillStatusEnum,
    SupplierStatusEnum,
} from "~/common/enum";
import { IPagination } from "./common.interface";
import { ILotTaken } from "./inventory.interface";

// ---------------------------------------------------------------------------
// Nhà cung cấp (danh mục dùng chung cả chuỗi)
// ---------------------------------------------------------------------------

export interface ISupplier {
    id: number;
    name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    tax_code: string | null;
    payment_terms_days: number;
    note: string | null;
    status: SupplierStatusEnum;
    created_at: Date;
    updated_at: Date;
    /** Có khi đọc danh sách */
    price_count?: number;
    /** Công nợ còn phải trả (theo phạm vi người xem) */
    outstanding?: string;
}

export interface ISupplierBody {
    name?: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    tax_code?: string | null;
    payment_terms_days?: number;
    note?: string | null;
    status?: SupplierStatusEnum;
}

export interface ISupplierPrice {
    supplier_id: number;
    supplier_name?: string;
    ingredient_id: number;
    ingredient_name?: string;
    unit?: string;
    unit_price: string;
    is_preferred: boolean;
    updated_at: Date;
}

export interface ISupplierPricesBody {
    items: { ingredient_id: number; unit_price: number; is_preferred?: boolean }[];
}

// ---------------------------------------------------------------------------
// Đơn đặt hàng
// ---------------------------------------------------------------------------

export interface IPurchaseOrderLine {
    id: number;
    purchase_order_id: number;
    ingredient_id: number;
    ingredient_name?: string;
    unit?: string;
    track_expiry?: boolean;
    shelf_life_days?: number | null;
    quantity: string;
    unit_price: string;
    received_quantity: string;
}

export interface IPurchaseOrder {
    id: number;
    code: string;
    restaurant_id: number;
    restaurant_name?: string;
    supplier_id: number;
    supplier_name?: string;
    status: PurchaseOrderStatusEnum;
    expected_date: string | null;
    note: string | null;
    total: string;
    /** Giá trị đã nhận (theo các phiếu nhập của đơn) */
    received_value?: string;
    created_by: number | null;
    created_by_name?: string | null;
    sent_at: Date | null;
    closed_at: Date | null;
    cancel_reason: string | null;
    created_at: Date;
    updated_at: Date;
    line_count?: number;
    lines?: IPurchaseOrderLine[];
    receipts?: { id: number; code: string; total_value: string; created_at: Date; created_by_name: string | null }[];
}

export interface IGetPurchaseOrders {
    purchase_orders: IPurchaseOrder[];
    pagination: IPagination;
}

export interface IPurchaseOrderBody {
    restaurant_id?: number;
    supplier_id?: number;
    expected_date?: string | null;
    note?: string | null;
    lines?: { ingredient_id: number; quantity: number; unit_price?: number }[];
}

export interface IReceivePurchaseBody {
    lines: { line_id: number; quantity: number; unit_price?: number; expiry_date?: string | null; lot_code?: string | null }[];
    note?: string | null;
}

/** Gợi ý số lượng đặt hàng cho một nguyên liệu */
export interface IPurchaseSuggestion {
    ingredient_id: number;
    name: string;
    unit: string;
    stock: number;
    min_quantity: number;
    /** Tiêu hao trung bình mỗi ngày (giao dịch consume trong `lookback_days` ngày gần nhất) */
    avg_daily_usage: number;
    /** Đang về (đơn đã gửi / nhận một phần, chưa nhận hết) */
    incoming: number;
    suggested_quantity: number;
    /** Giá của nhà cung cấp (nếu có trong bảng giá) */
    unit_price: number | null;
}

// ---------------------------------------------------------------------------
// Chuyển kho
// ---------------------------------------------------------------------------

export interface IStockTransferLine {
    id: number;
    transfer_id: number;
    ingredient_id: number;
    ingredient_name?: string;
    unit?: string;
    quantity: string;
    unit_cost: string;
    received_quantity: string | null;
    lots: Omit<ILotTaken, "lot_id">[];
}

export interface IStockTransfer {
    id: number;
    code: string;
    from_restaurant_id: number;
    from_restaurant_name?: string;
    to_restaurant_id: number;
    to_restaurant_name?: string;
    status: StockTransferStatusEnum;
    note: string | null;
    total_value: string;
    loss_value: string;
    created_by: number | null;
    created_by_name?: string | null;
    received_by: number | null;
    received_by_name?: string | null;
    received_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
    line_count?: number;
    lines?: IStockTransferLine[];
}

export interface IGetStockTransfers {
    transfers: IStockTransfer[];
    pagination: IPagination;
}

export interface ICreateTransferBody {
    from_restaurant_id?: number;
    to_restaurant_id: number;
    note?: string | null;
    lines: { ingredient_id: number; quantity: number }[];
}

export interface IReceiveTransferBody {
    /** Số thực nhận từng dòng (bỏ trống = nhận đủ) */
    lines?: { line_id: number; received_quantity: number }[];
    note?: string | null;
}

// ---------------------------------------------------------------------------
// Công nợ nhà cung cấp
// ---------------------------------------------------------------------------

export interface ISupplierBill {
    id: number;
    supplier_id: number;
    supplier_name?: string;
    restaurant_id: number;
    restaurant_name?: string;
    purchase_order_id: number | null;
    purchase_order_code?: string | null;
    receipt_id: number;
    receipt_code?: string;
    amount: string;
    paid_amount: string;
    remaining?: string;
    due_date: string;
    status: SupplierBillStatusEnum;
    overdue?: boolean;
    created_at: Date;
    payments?: ISupplierPayment[];
}

export interface ISupplierPayment {
    id: number;
    bill_id: number;
    amount: string;
    method: PaymentMethodEnum;
    reference: string | null;
    note: string | null;
    paid_at: Date;
    created_by: number | null;
    created_by_name?: string | null;
}

export interface IGetSupplierBills {
    bills: ISupplierBill[];
    pagination: IPagination;
    summary: { outstanding: string; overdue: string; bills: number };
}

export interface IPayBillBody {
    amount: number;
    method: PaymentMethodEnum;
    reference?: string | null;
    note?: string | null;
    paid_at?: Date;
}
