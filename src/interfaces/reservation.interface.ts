import { ReservationStatusEnum, RoomTypeEnum, UsageStatusEnum } from "~/common/enum";
import { IPagination } from "./common.interface";

/** Bàn gắn với reservation (kèm thông tin phòng) */
export interface IReservationTable {
    id: number;
    name: string;
    capacity: number;
    status: UsageStatusEnum;
    room_id: number;
    room_name: string;
    room_type: RoomTypeEnum;
}

export interface IReservation {
    id: number;
    restaurant_id: number;
    guest_user_id: number | null;
    contact_name: string;
    contact_phone: string;
    guest_count: number;
    start_time: Date;
    end_time: Date;
    status: ReservationStatusEnum;
    note: string | null;
    cancel_reason: string | null;
    arrived_at: Date | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    created_by: number | null;
    created_at: Date;
    updated_at: Date;
    /** Có khi lấy qua repository (subquery) */
    tables?: IReservationTable[];
    guest?: { id: number; full_name: string; phone_number: string | null; email: string | null } | null;
    created_by_name?: string | null;
    /** Order mở từ reservation (giai đoạn 4) */
    order?: { id: number; code: string; status: string } | null;
}

export interface IGetReservations {
    reservations: IReservation[];
    pagination: IPagination;
}

export interface ICreateReservationBody {
    restaurant_id?: number;
    guest_user_id?: number | null;
    contact_name?: string | null;
    contact_phone?: string | null;
    guest_count: number;
    start_time: Date;
    end_time: Date;
    note?: string | null;
    /** Mặc định `pending`; lễ tân có thể tạo thẳng ở trạng thái `confirmed` */
    status?: ReservationStatusEnum.PENDING | ReservationStatusEnum.CONFIRMED;
    table_ids: number[];
}

export interface IUpdateReservationBody extends Partial<Omit<ICreateReservationBody, "restaurant_id" | "status">> {}

export interface IUpdateReservationStatusBody {
    status: ReservationStatusEnum;
    cancel_reason?: string | null;
}

/** Cột ghi trực tiếp vào bảng reservations */
export interface IReservationRow {
    restaurant_id?: number;
    guest_user_id?: number | null;
    contact_name?: string;
    contact_phone?: string;
    guest_count?: number;
    start_time?: Date;
    end_time?: Date;
    status?: ReservationStatusEnum;
    note?: string | null;
    cancel_reason?: string | null;
    arrived_at?: Date | null;
    completed_at?: Date | null;
    cancelled_at?: Date | null;
    created_by?: number | null;
}

export interface IScheduleQuery {
    restaurantId: number;
    from: Date;
    to: Date;
}

export interface IAvailableTablesQuery {
    restaurantId: number;
    start_time: Date;
    end_time: Date;
    guest_count?: number;
    room_type?: RoomTypeEnum;
    /** Bỏ qua chính reservation đang sửa khi kiểm tra trùng lịch */
    exclude_reservation_id?: number;
}

export interface IAvailableTable extends IReservationTable {}

export interface IAvailableTables {
    tables: IAvailableTable[];
    /** Gợi ý bàn cho đủ số khách (rỗng nếu không tìm được) */
    suggested_table_ids: number[];
}
