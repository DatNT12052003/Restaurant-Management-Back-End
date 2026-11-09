import { IPagination } from "./common.interface";
import { IPayment } from "./payment.interface";

// ---------------------------------------------------------------------------
// Giai đoạn 14: chuyển khoản VietQR + webhook SePay
// ---------------------------------------------------------------------------

/** Thông tin để khách quét mã chuyển khoản */
export interface IQrInfo {
    /** Chuỗi VietQR (EMVCo), frontend vẽ thành mã QR */
    payload: string;
    bank_bin: string;
    account_no: string;
    account_name: string | null;
    amount: number;
    /** Nội dung chuyển khoản (chứa mã đối soát) */
    content: string;
    expires_at: Date | null;
}

export interface IQrPayment {
    payment: IPayment;
    qr: IQrInfo;
}

export interface ICreateQrPaymentBody {
    /** Bỏ trống = toàn bộ số còn phải thu */
    amount?: number;
}

export type GatewayTransactionStatus = "matched" | "unmatched" | "mismatch" | "ignored";

/** Giao dịch ngân hàng đã chuẩn hóa từ webhook của cổng */
export interface INormalizedTransfer {
    provider: string;
    provider_txn_id: string;
    direction: "in" | "out";
    account_number: string | null;
    amount: number;
    content: string | null;
    bank_reference: string | null;
    /** Mã đối soát cổng tự nhận ra (SePay `code`), có thể null */
    code: string | null;
    transaction_at: Date | null;
    raw: unknown;
}

export interface IGatewayTransaction {
    id: number;
    provider: string;
    provider_txn_id: string;
    restaurant_id: number | null;
    restaurant_name?: string | null;
    payment_id: number | null;
    order_id: number | null;
    order_code?: string | null;
    account_number: string | null;
    amount: string;
    content: string | null;
    bank_reference: string | null;
    matched_ref: string | null;
    transaction_at: Date | null;
    status: GatewayTransactionStatus;
    note: string | null;
    resolved_by: number | null;
    resolved_by_name?: string | null;
    resolved_at: Date | null;
    created_at: Date;
}

export interface IGetGatewayTransactions {
    transactions: IGatewayTransaction[];
    pagination: IPagination;
    /** Số giao dịch cần xử lý (chưa khớp / sai số tiền) trong phạm vi */
    counts: { unmatched: number; mismatch: number };
}

export interface IApplyTransactionBody {
    order_id: number;
}

// ---------------------------------------------------------------------------
// Hóa đơn điện tử
// ---------------------------------------------------------------------------

export type EInvoiceStatus = "pending" | "issued" | "failed" | "cancelled";

export interface IEInvoiceLine {
    name: string;
    unit: string;
    quantity: number;
    unit_price: number;
    amount: number;
    /** discount / service_fee: dòng điều chỉnh (giảm giá là số âm) */
    kind: "item" | "discount" | "service_fee";
}

export interface IEInvoiceSeller {
    name: string;
    tax_code: string;
    address: string;
    phone: string | null;
}

export interface IEInvoiceBuyer {
    buyer_type: "individual" | "company";
    buyer_name?: string | null;
    buyer_company?: string | null;
    buyer_tax_code?: string | null;
    buyer_address?: string | null;
    buyer_email?: string | null;
    buyer_phone?: string | null;
}

export interface IEInvoice extends Required<IEInvoiceBuyer> {
    id: number;
    order_id: number;
    order_code?: string;
    restaurant_id: number;
    restaurant_name?: string;
    provider: string;
    status: EInvoiceStatus;
    source: "auto" | "manual";
    seller: IEInvoiceSeller;
    lines: IEInvoiceLine[];
    amount_before_tax: string;
    tax_rate: string;
    tax_amount: string;
    total: string;
    series: string | null;
    invoice_no: string | null;
    lookup_code: string | null;
    lookup_url: string | null;
    provider_ref: string | null;
    issued_at: Date | null;
    attempts: number;
    next_retry_at: Date | null;
    error_message: string | null;
    cancelled_at: Date | null;
    cancelled_by: number | null;
    cancel_reason: string | null;
    created_by: number | null;
    created_by_name?: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface IGetEInvoices {
    e_invoices: IEInvoice[];
    pagination: IPagination;
}

/** Kết quả nhà cung cấp trả về khi cấp số hóa đơn */
export interface IEInvoiceIssued {
    series: string;
    invoice_no: string;
    lookup_code: string;
    lookup_url: string | null;
    provider_ref: string;
    issued_at: Date;
}

/** Nhà cung cấp hóa đơn điện tử (VNPT, Viettel, MISA... cài đặt sau theo hợp đồng) */
export interface IEInvoiceProvider {
    name: string;
    issue(invoice: IEInvoice): Promise<IEInvoiceIssued>;
    cancel(invoice: IEInvoice, reason: string): Promise<void>;
}
