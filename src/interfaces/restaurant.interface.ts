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
    /** Bàn tự chuyển sang `reserved` trước giờ hẹn bao nhiêu phút (0 = tắt) */
    reservation_hold_minutes: number;
    /** Khách trễ quá bao nhiêu phút thì tự đánh dấu không đến (0 = tắt) */
    no_show_after_minutes: number;
    /** Giai đoạn 13: kênh khách hàng */
    phone?: string | null;
    online_booking_enabled?: boolean;
    online_booking_minutes?: number;
    online_booking_lead_minutes?: number;
    online_booking_max_days?: number;
    online_booking_max_guests?: number;
    qr_ordering_enabled?: boolean;
    /** Giai đoạn 14: chuyển khoản QR (SePay) và hóa đơn điện tử */
    bank_bin?: string | null;
    bank_account_no?: string | null;
    bank_account_name?: string | null;
    transfer_qr_enabled?: boolean;
    legal_name?: string | null;
    tax_code?: string | null;
    einvoice_series?: string | null;
    einvoice_auto_issue?: boolean;
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
    reservation_hold_minutes?: number;
    no_show_after_minutes?: number;
    /** Giai đoạn 13: kênh khách hàng */
    phone?: string | null;
    online_booking_enabled?: boolean;
    online_booking_minutes?: number;
    online_booking_lead_minutes?: number;
    online_booking_max_days?: number;
    online_booking_max_guests?: number;
    qr_ordering_enabled?: boolean;
    /** Giai đoạn 14: chuyển khoản QR (SePay) và hóa đơn điện tử */
    bank_bin?: string | null;
    bank_account_no?: string | null;
    bank_account_name?: string | null;
    transfer_qr_enabled?: boolean;
    legal_name?: string | null;
    tax_code?: string | null;
    einvoice_series?: string | null;
    einvoice_auto_issue?: boolean;
}

export interface IUpdateRestaurantBody extends Partial<ICreateRestaurantBody> {}
