/** Cách nhóm chuỗi thời gian của báo cáo */
export type ReportGroupBy = "day" | "week" | "month";

/** Tham số chung: khoảng ngày (theo giờ Việt Nam, gồm cả hai đầu) và nhà hàng (null = cả chuỗi) */
export interface IReportRange {
    from: string;
    to: string;
    restaurantId: number | null;
}

/** Số liệu tổng của một khoảng thời gian */
export interface IReportTotals {
    net_revenue: number;
    collected: number;
    refunded: number;
    completed_orders: number;
    cancelled_orders: number;
    gross_sales: number;
    discount_total: number;
    guests: number;
    avg_order_value: number;
    reservations: number;
    reservations_no_show: number;
    reservations_cancelled: number;
}

/** Tình hình hiện tại (không phụ thuộc khoảng ngày) */
export interface IReportLive {
    open_orders: number;
    occupied_tables: number;
    total_tables: number;
    upcoming_reservations_today: number;
    low_stock: number;
    today_net_revenue: number;
}

export interface IReportOverview {
    range: { from: string; to: string };
    previous_range: { from: string; to: string };
    current: IReportTotals;
    previous: IReportTotals;
    live: IReportLive;
}

export interface IRevenuePoint {
    period: string;
    collected: number;
    refunded: number;
    net: number;
    orders: number;
    guests: number;
    gross_sales: number;
}

export interface IRevenueReport {
    group_by: ReportGroupBy;
    series: IRevenuePoint[];
    /** Doanh thu ròng theo kỳ và nhà hàng (dùng cho biểu đồ chồng khi xem cả chuỗi) */
    series_by_restaurant: { period: string; restaurant_id: number; net: number }[];
    by_restaurant: { restaurant_id: number; restaurant_name: string; net: number; orders: number; gross_sales: number }[];
    by_method: { method: string; collected: number; refunded: number; net: number; count: number }[];
    totals: { collected: number; refunded: number; net: number; orders: number; guests: number; gross_sales: number };
}

export interface ITopItem {
    id: number;
    name: string;
    category?: string;
    quantity: number;
    revenue: number;
    order_count: number;
}

export interface ITopItemsReport {
    dishes: ITopItem[];
    combos: ITopItem[];
}

export interface IOccupancyGroup {
    table_count: number;
    occupied_hours: number;
    available_hours: number;
    sessions: number;
    /** Tỷ lệ lấp đầy (0–1), null khi không có giờ mở cửa trong khoảng */
    occupancy_rate: number | null;
    /** Số lượt khách trên mỗi bàn */
    turnover: number | null;
}

export interface IOccupancyReport {
    days: number;
    summary: IOccupancyGroup;
    by_restaurant: (IOccupancyGroup & {
        restaurant_id: number;
        restaurant_name: string;
        open_time: string;
        close_time: string;
    })[];
    by_room: (IOccupancyGroup & { room_id: number; room_name: string; restaurant_id: number })[];
    /** Số bàn có khách trung bình theo từng giờ trong ngày (0–23), tính trên tổng số bàn */
    by_hour: { hour: number; occupied_hours: number; avg_occupancy: number | null }[];
}

export interface ITipsReport {
    group_by: ReportGroupBy;
    total: number;
    series: { period: string; tip_total: number }[];
    /** `staff_id` null = tip không gắn nhân viên */
    by_staff: { staff_id: number | null; full_name: string | null; tip_total: number; payments: number; orders: number }[];
}

export interface IInventoryReport {
    group_by: ReportGroupBy;
    series: { period: string; import_value: number; export_value: number; adjust_value: number; receipts: number }[];
    totals: { import_value: number; export_value: number; adjust_value: number; import_receipts: number };
    top_ingredients: { ingredient_id: number; name: string; unit: string; quantity: number; value: number }[];
    by_supplier: { supplier: string | null; value: number; receipts: number }[];
}
