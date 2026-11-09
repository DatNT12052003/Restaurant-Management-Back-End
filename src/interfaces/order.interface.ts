import { KitchenStationEnum, OrderItemStatusEnum, OrderStatusEnum, RoomTypeEnum, UsageStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";
import { IAuditContext } from "./audit.interface";
import { IPayment } from "./payment.interface";

/** Món lẻ (`dish`) hoặc combo trong order */
export type OrderLineKind = "dish" | "combo";

export interface IOrderTable {
    id: number;
    name: string;
    capacity: number;
    status: UsageStatusEnum;
    room_id: number;
    room_name: string;
    room_type: RoomTypeEnum;
}

export interface IOrderLine {
    id: number;
    kind: OrderLineKind;
    order_id: number;
    round_id: number;
    /** dish_id hoặc combo_id */
    item_id: number;
    name: string;
    quantity: number;
    /** Giá tại thời điểm gọi (pg trả numeric dạng chuỗi) */
    current_price: string;
    note: string | null;
    station: KitchenStationEnum;
    status: OrderItemStatusEnum;
    confirmed_at: Date | null;
    cooking_at: Date | null;
    ready_at: Date | null;
    served_at: Date | null;
    cancelled_at: Date | null;
    cancel_reason: string | null;
    /** Chỉ có với combo: các món trong combo */
    combo_items?: { dish_id: number; name: string; quantity: number }[];
}

export interface IOrderRound {
    id: number;
    order_id: number;
    round_no: number;
    table_id: number | null;
    table_name: string | null;
    note: string | null;
    sent_at: Date;
    created_by: number | null;
    created_by_name: string | null;
    lines: IOrderLine[];
}

export interface IOrder {
    id: number;
    code: string;
    restaurant_id: number;
    reservation_id: number | null;
    guest_user_id: number | null;
    guest_count: number;
    created_by: number | null;
    assigned_staff_id: number | null;
    status: OrderStatusEnum;
    subtotal: string;
    discount_amount: string;
    /** Giai đoạn 13: điểm đổi (giảm `points_discount`, nằm trong `discount_amount`) và điểm đã cộng khi hoàn tất */
    points_redeemed?: number;
    points_discount?: string;
    points_awarded?: number;
    total: string;
    note: string | null;
    cancel_reason: string | null;
    cancelled_by: number | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    /** Đã gộp vào order này (trạng thái `merged`) */
    merged_into_order_id?: number | null;
    merged_into_code?: string | null;
    /** Tổng tiền tip đã nhận (không tính vào `total`) */
    tip_amount?: string;
    created_at: Date;
    updated_at: Date;
    /** Bàn đang thuộc order (có khi đọc qua repository) */
    tables?: IOrderTable[];
    created_by_name?: string | null;
    assigned_staff_name?: string | null;
    guest?: { id: number; full_name: string; phone_number: string | null } | null;
    service_fee_rate?: string;
    tax_rate?: string;
    service_fee?: string;
    tax?: string;
    /** Đã thu (trừ hoàn) và đang chờ xác nhận — có khi đọc qua repository */
    paid_amount?: string;
    pending_amount?: string;
    discount?: {
        id: number;
        code: string;
        name: string;
        type: string;
        value: string;
        min_order_value: string;
        amount: string;
    } | null;
    /** Đếm món theo trạng thái (danh sách / sơ đồ) */
    line_counts?: Partial<Record<OrderItemStatusEnum, number>>;
}

export interface IOrderDetail extends IOrder {
    rounds: IOrderRound[];
    payments: IPayment[];
}

export interface IGetOrders {
    orders: IOrder[];
    pagination: IPagination;
}

export interface ICreateOrderBody {
    restaurant_id?: number;
    reservation_id?: number;
    table_ids?: number[];
    guest_count?: number;
    guest_user_id?: number | null;
    assigned_staff_id?: number | null;
    note?: string | null;
}

export interface IUpdateOrderBody {
    guest_count?: number;
    guest_user_id?: number | null;
    assigned_staff_id?: number | null;
    note?: string | null;
}

export interface IRoundLineBody {
    quantity: number;
    note?: string | null;
}

export interface ICreateRoundBody {
    table_id?: number;
    note?: string | null;
    items?: (IRoundLineBody & { dish_id: number })[];
    combos?: (IRoundLineBody & { combo_id: number })[];
}

export interface IUpdateLineStatusBody {
    status: OrderItemStatusEnum;
    cancel_reason?: string | null;
}

export interface IBatchLineStatusBody extends IUpdateLineStatusBody {
    lines?: { kind: OrderLineKind; id: number }[];
    round_id?: number;
    /** Chỉ dùng với `round_id`: chỉ đổi các dòng của bếp hoặc quầy pha chế */
    station?: KitchenStationEnum;
}

export interface ISplitOrderBody {
    lines: { kind: OrderLineKind; id: number; quantity: number }[];
    target_order_id?: number;
    table_ids?: number[];
    guest_count?: number;
    note?: string | null;
}

/** Người thao tác: id và quyền (để kiểm tra quyền theo từng bước chuyển trạng thái) */
export interface IOrderActor {
    id: number;
    permissions: string[];
    /** Ngữ cảnh ghi audit log khi hủy món */
    audit?: IAuditContext;
}

/** Một dòng trên màn hình bếp / pha chế */
export interface IKitchenLine extends IOrderLine {
    order_code: string;
    round_no: number;
    sent_at: Date;
    table_names: string | null;
    order_note: string | null;
}

/** Cột ghi trực tiếp vào bảng orders */
export interface IOrderRow {
    code?: string;
    restaurant_id?: number;
    reservation_id?: number | null;
    guest_user_id?: number | null;
    guest_count?: number;
    created_by?: number | null;
    assigned_staff_id?: number | null;
    status?: OrderStatusEnum;
    note?: string | null;
    cancel_reason?: string | null;
    cancelled_by?: number | null;
    completed_at?: Date | null;
    cancelled_at?: Date | null;
    /** Tỷ lệ % chụp từ nhà hàng lúc mở order */
    service_fee_rate?: string | number;
    tax_rate?: string | number;
    merged_into_order_id?: number | null;
}
