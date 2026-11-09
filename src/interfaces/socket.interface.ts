import { KitchenStationEnum, OrderItemStatusEnum, OrderStatusEnum, PaymentStatusEnum, UsageStatusEnum } from "~/common/enum";

/**
 * Sự kiện realtime (giai đoạn 4). Payload chỉ mang định danh và trạng thái mới;
 * client tải lại dữ liệu qua REST khi nhận sự kiện.
 *
 * Room:
 * - `restaurant:{id}`: mọi nhân viên của nhà hàng (admin tự đăng ký qua `restaurant:subscribe`)
 * - `restaurant:{id}:kitchen` | `:bar` | `:floor`: theo vai trò (bếp / pha chế / sảnh)
 */
export interface IOrderEventPayload {
    restaurant_id: number;
    order_id: number;
    code: string;
    status: OrderStatusEnum;
}

export interface IRoundSentPayload {
    restaurant_id: number;
    order_id: number;
    code: string;
    round_id: number;
    round_no: number;
    /** Nơi chế biến có món trong đợt này */
    stations: KitchenStationEnum[];
}

export interface IOrderItemStatusPayload {
    restaurant_id: number;
    order_id: number;
    line_id: number;
    kind: "dish" | "combo";
    status: OrderItemStatusEnum;
    station: KitchenStationEnum;
}

export interface ITableStatusPayload {
    restaurant_id: number;
    table_ids: number[];
    status: UsageStatusEnum;
}

export interface IPaymentEventPayload {
    restaurant_id: number;
    order_id: number;
    payment_id: number;
    status: PaymentStatusEnum;
}

export interface IInventoryEventPayload {
    restaurant_id: number;
    ingredient_ids: number[];
    /** Nguyên liệu vừa xuống bằng / dưới ngưỡng tồn tối thiểu */
    low_ingredient_ids: number[];
}

export interface IReservationEventPayload {
    restaurant_id: number;
    reservation_id: number;
}

// Các event Server gửi về cho Client lắng nghe
export interface IOrderRequestEventPayload {
    restaurant_id: number;
    request_id: number;
    table_id: number;
    status: string;
}

export interface ServerToClientEvents {
    "order:created": (data: IOrderEventPayload) => void;
    /** Đổi bàn, số khách, ghi chú, tiền, trạng thái order (gồm hoàn tất / hủy) */
    "order:updated": (data: IOrderEventPayload) => void;
    "order:round_sent": (data: IRoundSentPayload) => void;
    "order_item:status_changed": (data: IOrderItemStatusPayload) => void;
    "table:status_changed": (data: ITableStatusPayload) => void;
    "reservation:changed": (data: IReservationEventPayload) => void;
    /** Thu tiền, xác nhận / hủy giao dịch chờ, hoàn tiền */
    "payment:changed": (data: IPaymentEventPayload) => void;
    /** Phiếu kho, đổi ngưỡng tồn tối thiểu */
    "inventory:changed": (data: IInventoryEventPayload) => void;
    /** Giai đoạn 13: khách gửi / nhân viên duyệt món gọi qua QR */
    "order_request:created": (data: IOrderRequestEventPayload) => void;
    "order_request:changed": (data: IOrderRequestEventPayload) => void;
    /** Khách gửi phản hồi */
    "feedback:created": (data: { restaurant_id: number; feedback_id: number; is_complaint: boolean }) => void;
    /** Giai đoạn 14: giao dịch chuyển khoản chưa khớp / sai số tiền, cần đối soát */
    "gateway:transaction": (data: { restaurant_id: number; transaction_id: number | null; status: string }) => void;
    /** Hóa đơn điện tử đã cấp số / gửi lỗi / bị hủy */
    "einvoice:changed": (data: { restaurant_id: number; e_invoice_id: number; order_id: number; status: string }) => void;
    "restaurant:subscribed": (restaurantId: number | null) => void;
}

// Các event Client gửi lên cho Server lắng nghe
export interface ClientToServerEvents {
    /** Chỉ admin: chọn nhà hàng muốn nhận sự kiện (null = hủy đăng ký) */
    "restaurant:subscribe": (restaurantId: number | null) => void;
}

export interface InterServerEvents {}

export interface SocketData {
    account?: { account_id: number; username: string };
    userId?: number;
    isAdmin?: boolean;
    /** Nhà hàng đang nhận sự kiện */
    restaurantId?: number | null;
}
