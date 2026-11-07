import {
    DiscountStatusEnum,
    DiscountTypeEnum,
    OrderStatusEnum,
    PaymentMethodEnum,
    PaymentStatusEnum,
    PaymentTypeEnum,
} from "~/common/enum";
import { IPagination } from "./common.interface";

// ---------------------------------------------------------------------------
// Mã giảm giá
// ---------------------------------------------------------------------------

export interface IDiscount {
    id: number;
    code: string;
    name: string;
    description: string | null;
    /** null = cả chuỗi */
    restaurant_id: number | null;
    restaurant_name?: string | null;
    type: DiscountTypeEnum;
    value: string;
    min_order_value: string;
    max_discount: string | null;
    start_at: Date;
    end_at: Date | null;
    usage_limit: number | null;
    per_user_limit: number | null;
    used_count: number;
    status: DiscountStatusEnum;
    created_by: number | null;
    created_at: Date;
    updated_at: Date;
}

export interface IGetDiscounts {
    discounts: IDiscount[];
    pagination: IPagination;
}

export interface IDiscountBody {
    code?: string;
    name?: string;
    description?: string | null;
    restaurant_id?: number | null;
    type?: DiscountTypeEnum;
    value?: number;
    min_order_value?: number;
    max_discount?: number | null;
    start_at?: Date;
    end_at?: Date | null;
    usage_limit?: number | null;
    per_user_limit?: number | null;
    status?: DiscountStatusEnum;
    created_by?: number | null;
}

// ---------------------------------------------------------------------------
// Thanh toán
// ---------------------------------------------------------------------------

export interface IPayment {
    id: number;
    order_id: number;
    restaurant_id: number;
    type: PaymentTypeEnum;
    method: PaymentMethodEnum;
    amount: string;
    status: PaymentStatusEnum;
    received_amount: string | null;
    change_amount: string | null;
    reference: string | null;
    note: string | null;
    refund_of_payment_id: number | null;
    cashier_id: number | null;
    paid_at: Date | null;
    created_at: Date;
    updated_at: Date;
    /** Có khi đọc qua repository */
    cashier_name?: string | null;
    order_code?: string;
    /** Payment gốc: đã hoàn bao nhiêu */
    refunded_amount?: string;
}

export interface IGetPayments {
    payments: IPayment[];
    pagination: IPagination;
    /** Tổng tiền theo bộ lọc hiện tại: thu, hoàn, ròng */
    summary: { collected: string; refunded: string; net: string };
}

export interface ICreatePaymentBody {
    method: PaymentMethodEnum;
    amount: number;
    /** Tiền mặt: khách đưa (để tính tiền thối) */
    received_amount?: number | null;
    reference?: string | null;
    note?: string | null;
    /** false = tạo giao dịch chờ xác nhận (thẻ / chuyển khoản) */
    confirm?: boolean;
}

export interface IRefundBody {
    amount: number;
    reason: string;
}

/** Cột ghi trực tiếp vào bảng payments */
export interface IPaymentRow {
    order_id?: number;
    restaurant_id?: number;
    type?: PaymentTypeEnum;
    method?: PaymentMethodEnum;
    amount?: number;
    status?: PaymentStatusEnum;
    received_amount?: number | null;
    change_amount?: number | null;
    reference?: string | null;
    note?: string | null;
    refund_of_payment_id?: number | null;
    cashier_id?: number | null;
    paid_at?: Date | null;
}

/** Tiền đã thu (trừ hoàn) và đang chờ của một order */
export interface IPaymentSummary {
    paid: number;
    pending: number;
}

// ---------------------------------------------------------------------------
// Hóa đơn
// ---------------------------------------------------------------------------

export interface IInvoiceLine {
    kind: "dish" | "combo";
    item_id: number;
    name: string;
    unit_price: string;
    quantity: number;
    amount: string;
}

export interface IInvoice {
    order: {
        id: number;
        code: string;
        status: OrderStatusEnum;
        guest_count: number;
        created_at: Date;
        completed_at: Date | null;
        tables: string[];
        staff_name: string | null;
        guest_name: string | null;
    };
    restaurant: { id: number; name: string; address: string };
    lines: IInvoiceLine[];
    discount: { code: string; name: string; amount: string } | null;
    subtotal: string;
    discount_amount: string;
    service_fee_rate: string;
    service_fee: string;
    tax_rate: string;
    tax: string;
    total: string;
    payments: IPayment[];
    paid: number;
    /** Còn phải thu (âm = thu thừa, cần hoàn) */
    remaining: number;
}

/** Ngữ cảnh ghi audit log */
export interface IAuditContext {
    accountId?: number | null;
    userId?: number | null;
    ip?: string | null;
    userAgent?: string | null;
}
