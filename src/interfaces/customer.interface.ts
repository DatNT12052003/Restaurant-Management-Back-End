import { FeedbackStatusEnum, LoyaltyTransactionTypeEnum, OrderRequestStatusEnum, ReservationStatusEnum } from "~/common/enum";

/** Giai đoạn 13: kênh khách hàng. pg trả numeric dưới dạng chuỗi. */
type Numeric = string | number;

// ---------------------------------------------------------------------------
// Thông tin công khai
// ---------------------------------------------------------------------------

export interface IPublicRestaurant {
    id: number;
    name: string;
    address: string;
    phone: string | null;
    open_time: string;
    close_time: string;
    image_url: string | null;
    online_booking_enabled: boolean;
    online_booking_max_guests: number;
    online_booking_max_days: number;
    online_booking_lead_minutes: number;
    online_booking_minutes: number;
}

export interface IPublicMenuItem {
    id: number;
    kind: "dish" | "combo";
    name: string;
    description: string | null;
    category: string | null;
    price: Numeric;
    image_url: string | null;
    tags: { id: number; name: string }[];
    /** Combo: các món trong combo */
    items?: { name: string; quantity: number }[];
}

export interface IPublicMenu {
    restaurant: IPublicRestaurant;
    images: string[];
    dishes: IPublicMenuItem[];
    combos: IPublicMenuItem[];
}

export interface IBookingSlot {
    time: string;
    available: boolean;
}

// ---------------------------------------------------------------------------
// Đặt bàn online
// ---------------------------------------------------------------------------

export interface IOnlineBookingBody {
    restaurant_id: number;
    date: string;
    time: string;
    guest_count: number;
    contact_name?: string;
    contact_phone?: string;
    contact_email?: string;
    note?: string | null;
    otp_code?: string;
}

export interface IPublicReservation {
    lookup_code: string | null;
    restaurant_id: number;
    restaurant_name: string;
    restaurant_address: string;
    restaurant_phone: string | null;
    contact_name: string;
    contact_phone: string;
    guest_count: number;
    start_time: Date;
    end_time: Date;
    status: ReservationStatusEnum;
    note: string | null;
    cancel_reason: string | null;
    created_at: Date;
}

// ---------------------------------------------------------------------------
// Gọi món QR
// ---------------------------------------------------------------------------

export interface IOrderRequestItems {
    dishes: { dish_id: number; quantity: number; note?: string | null }[];
    combos: { combo_id: number; quantity: number; note?: string | null }[];
}

export interface IOrderRequest {
    id: number;
    restaurant_id: number;
    table_id: number;
    table_name?: string;
    room_name?: string;
    order_id: number | null;
    order_code?: string | null;
    round_id: number | null;
    guest_user_id: number | null;
    guest_name?: string | null;
    client_token?: string;
    guest_count: number | null;
    items: IOrderRequestItems;
    /** Tên và giá hiện tại của các món (để hiển thị) */
    lines?: { kind: "dish" | "combo"; id: number; name: string; quantity: number; note: string | null; price: Numeric | null }[];
    note: string | null;
    status: OrderRequestStatusEnum;
    reject_reason: string | null;
    decided_by: number | null;
    decided_by_name?: string | null;
    decided_at: Date | null;
    created_at: Date;
}

export interface ICreateOrderRequestBody {
    client_token: string;
    guest_count?: number | null;
    note?: string | null;
    dishes?: IOrderRequestItems["dishes"];
    combos?: IOrderRequestItems["combos"];
}

export interface ITableOrderLine {
    kind: "dish" | "combo";
    name: string;
    quantity: number;
    status: string;
    price: Numeric;
}

export interface IPublicTable {
    table: { id: number; name: string; room_name: string };
    restaurant: { id: number; name: string; qr_ordering_enabled: boolean };
    /** Order đang mở của bàn: các món đã gọi (để khách xem) */
    order: { code: string; total: Numeric; lines: ITableOrderLine[] } | null;
    /** Order vừa hoàn tất ở bàn (trong 24 giờ, chưa có phản hồi, bàn chưa có order mới): khách được đánh giá */
    feedback_order: { id: number; code: string; completed_at: Date } | null;
}

// ---------------------------------------------------------------------------
// Điểm thưởng
// ---------------------------------------------------------------------------

export interface ILoyaltySettings {
    enabled: boolean;
    earn_amount: number;
    point_value: number;
    max_redeem_percent: number;
    regular_visit_count: number;
    regular_window_months: number;
    updated_at?: Date;
}

export interface ILoyaltyGuest {
    id: number;
    full_name: string;
    phone_number: string | null;
    email: string | null;
    guest_status: string | null;
    loyalty_points: number;
    /** Điểm còn dùng được = số dư − điểm đang giữ ở các order khác chưa đóng */
    available_points: number;
}

export interface ILoyaltyTransaction {
    id: number;
    user_id: number;
    order_id: number | null;
    order_code?: string | null;
    type: LoyaltyTransactionTypeEnum;
    points: number;
    balance_after: number;
    note: string | null;
    created_by_name?: string | null;
    created_at: Date;
}

// ---------------------------------------------------------------------------
// Phản hồi
// ---------------------------------------------------------------------------

export interface IFeedbackBody {
    food_rating: number;
    service_rating: number;
    ambience_rating: number;
    comment?: string | null;
    is_complaint?: boolean;
    contact_phone?: string | null;
}

export interface IFeedback {
    id: number;
    order_id: number;
    order_code?: string;
    restaurant_id: number;
    restaurant_name?: string;
    guest_user_id: number | null;
    guest_name?: string | null;
    food_rating: number;
    service_rating: number;
    ambience_rating: number;
    comment: string | null;
    is_complaint: boolean;
    contact_phone: string | null;
    status: FeedbackStatusEnum;
    reply: string | null;
    replied_by: number | null;
    replied_by_name?: string | null;
    replied_at: Date | null;
    created_at: Date;
}

export interface IFeedbackSummary {
    count: number;
    complaints: number;
    open: number;
    avg_food: number | null;
    avg_service: number | null;
    avg_ambience: number | null;
    by_restaurant: { restaurant_id: number; restaurant_name: string; count: number; complaints: number; avg_overall: number | null }[];
}

// ---------------------------------------------------------------------------
// Tài khoản khách
// ---------------------------------------------------------------------------

export interface ICustomerProfile {
    id: number;
    full_name: string;
    email: string | null;
    phone_number: string | null;
    guest_status: string | null;
    loyalty_points: number;
    visits: number;
    total_spent: Numeric;
    /** Số lần ghé trong cửa sổ xét khách thân thiết / ngưỡng */
    regular_progress: { visits: number; required: number; months: number };
    loyalty: ILoyaltySettings;
}

export interface ICustomerOrder {
    id: number;
    code: string;
    restaurant_id: number;
    restaurant_name: string;
    status: string;
    total: Numeric;
    points_redeemed: number;
    points_awarded: number;
    created_at: Date;
    completed_at: Date | null;
    lines: { name: string; quantity: number; price: Numeric }[];
    feedback: IFeedback | null;
}
