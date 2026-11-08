import { REPORT_ERROR } from "~/common/error-code/report";
import {
    IInventoryReport,
    IOccupancyGroup,
    IOccupancyReport,
    IReportOverview,
    IReportRange,
    IReportTotals,
    IRevenuePoint,
    IRevenueReport,
    ITipsReport,
    ITopItemsReport,
    ReportGroupBy,
} from "~/interfaces";
import { reportRepository } from "~/repositories";

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

const DAY_MS = 86_400_000;
const toDay = (v: string) => Date.parse(`${v}T00:00:00Z`);
const fromDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Khoảng liền trước, cùng số ngày (để so sánh) */
const previousRange = (r: IReportRange): IReportRange => {
    const days = (toDay(r.to) - toDay(r.from)) / DAY_MS + 1;
    return { ...r, from: fromDay(toDay(r.from) - days * DAY_MS), to: fromDay(toDay(r.from) - DAY_MS) };
};

const totalsOf = (row: Record<string, unknown>): IReportTotals => {
    const completed = num(row.completed_orders);
    const gross = num(row.gross_sales);
    return {
        net_revenue: num(row.net_revenue),
        collected: num(row.collected),
        refunded: num(row.refunded),
        completed_orders: completed,
        cancelled_orders: num(row.cancelled_orders),
        gross_sales: gross,
        discount_total: num(row.discount_total),
        guests: num(row.guests),
        avg_order_value: completed ? round2(gross / completed) : 0,
        reservations: num(row.reservations),
        reservations_no_show: num(row.reservations_no_show),
        reservations_cancelled: num(row.reservations_cancelled),
    };
};

/** Số liệu tổng của khoảng, so với khoảng liền trước, kèm tình hình hiện tại */
export const getOverview = async (r: IReportRange): Promise<IReportOverview | number> => {
    try {
        const prev = previousRange(r);
        const [current, previous, live] = await Promise.all([
            reportRepository.getTotals(r),
            reportRepository.getTotals(prev),
            reportRepository.getLive(r.restaurantId),
        ]);
        return {
            range: { from: r.from, to: r.to },
            previous_range: { from: prev.from, to: prev.to },
            current: totalsOf(current),
            previous: totalsOf(previous),
            live: {
                open_orders: num(live.open_orders),
                occupied_tables: num(live.occupied_tables),
                total_tables: num(live.total_tables),
                upcoming_reservations_today: num(live.upcoming_reservations_today),
                low_stock: num(live.low_stock),
                today_net_revenue: num(live.today_net_revenue),
            },
        };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};

/** Doanh thu theo kỳ (ngày / tuần / tháng), theo nhà hàng và theo phương thức thanh toán */
export const getRevenue = async (r: IReportRange, groupBy: ReportGroupBy): Promise<IRevenueReport | number> => {
    try {
        const [periods, payments, orders, methods] = await Promise.all([
            reportRepository.getPeriods(r, groupBy),
            reportRepository.getPaymentsByPeriod(r, groupBy),
            reportRepository.getOrdersByPeriod(r, groupBy),
            reportRepository.getPaymentsByMethod(r),
        ]);

        const series = new Map<string, IRevenuePoint>(
            periods.map((period) => [period, { period, collected: 0, refunded: 0, net: 0, orders: 0, guests: 0, gross_sales: 0 }]),
        );
        const point = (period: string) => {
            if (!series.has(period)) {
                series.set(period, { period, collected: 0, refunded: 0, net: 0, orders: 0, guests: 0, gross_sales: 0 });
            }
            return series.get(period)!;
        };
        const byRestaurant = new Map<number, { net: number; orders: number; gross_sales: number }>();
        const restaurant = (id: number) => {
            if (!byRestaurant.has(id)) byRestaurant.set(id, { net: 0, orders: 0, gross_sales: 0 });
            return byRestaurant.get(id)!;
        };
        const seriesByRestaurant = new Map<string, { period: string; restaurant_id: number; net: number }>();

        for (const row of payments) {
            const collected = num(row.collected);
            const refunded = num(row.refunded);
            const p = point(row.period);
            p.collected += collected;
            p.refunded += refunded;
            p.net += collected - refunded;
            restaurant(row.restaurant_id).net += collected - refunded;
            const key = `${row.period}|${row.restaurant_id}`;
            const entry = seriesByRestaurant.get(key) ?? { period: row.period, restaurant_id: row.restaurant_id, net: 0 };
            entry.net += collected - refunded;
            seriesByRestaurant.set(key, entry);
        }
        for (const row of orders) {
            const p = point(row.period);
            p.orders += num(row.orders);
            p.guests += num(row.guests);
            p.gross_sales += num(row.gross_sales);
            const rest = restaurant(row.restaurant_id);
            rest.orders += num(row.orders);
            rest.gross_sales += num(row.gross_sales);
        }

        const names = await reportRepository.getRestaurantNames([...byRestaurant.keys()]);
        const list = [...series.values()]
            .sort((a, b) => a.period.localeCompare(b.period))
            .map((p) => ({ ...p, collected: round2(p.collected), refunded: round2(p.refunded), net: round2(p.net), gross_sales: round2(p.gross_sales) }));
        const sum = (key: keyof IRevenuePoint) => round2(list.reduce((acc, p) => acc + num(p[key]), 0));

        return {
            group_by: groupBy,
            series: list,
            series_by_restaurant: [...seriesByRestaurant.values()].map((e) => ({ ...e, net: round2(e.net) })),
            by_restaurant: [...byRestaurant.entries()]
                .map(([id, v]) => ({
                    restaurant_id: id,
                    restaurant_name: names[id] ?? `#${id}`,
                    net: round2(v.net),
                    orders: v.orders,
                    gross_sales: round2(v.gross_sales),
                }))
                .sort((a, b) => b.net - a.net),
            by_method: methods.map((m) => ({
                method: m.method,
                collected: num(m.collected),
                refunded: num(m.refunded),
                net: round2(num(m.collected) - num(m.refunded)),
                count: num(m.count),
            })),
            totals: {
                collected: sum("collected"),
                refunded: sum("refunded"),
                net: sum("net"),
                orders: sum("orders"),
                guests: sum("guests"),
                gross_sales: sum("gross_sales"),
            },
        };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};

/** Món và combo bán chạy (theo số lượng) */
export const getTopItems = async (r: IReportRange, limit: number, category: string | null): Promise<ITopItemsReport | number> => {
    try {
        const [dishes, combos] = await Promise.all([
            reportRepository.getTopDishes(r, limit, category),
            category ? Promise.resolve([]) : reportRepository.getTopCombos(r, limit),
        ]);
        const map = (row: Record<string, unknown>) => ({
            id: num(row.id),
            name: String(row.name),
            ...(row.category ? { category: String(row.category) } : {}),
            quantity: num(row.quantity),
            revenue: round2(num(row.revenue)),
            order_count: num(row.order_count),
        });
        return { dishes: dishes.map(map), combos: combos.map(map) };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};

const occupancyGroup = (tableCount: number, occupied: number, available: number, sessions: number): IOccupancyGroup => ({
    table_count: tableCount,
    occupied_hours: round2(occupied),
    available_hours: round2(available),
    sessions,
    occupancy_rate: available > 0 ? Math.round((occupied / available) * 10000) / 10000 : null,
    turnover: tableCount > 0 ? round2(sessions / tableCount) : null,
});

/**
 * Tỷ lệ lấp đầy bàn = giờ-bàn có khách / (số bàn × số giờ mở cửa mỗi ngày × số ngày đã qua).
 * Giờ có khách tính theo lượt ngồi bàn của order (kể cả ngoài giờ mở cửa), nên tỷ lệ có thể vượt 100%.
 */
export const getTableOccupancy = async (r: IReportRange): Promise<IOccupancyReport | number> => {
    try {
        const [days, rooms, hours, byHour] = await Promise.all([
            reportRepository.getElapsedDays(r),
            reportRepository.getOccupancyByRoom(r),
            reportRepository.getRestaurantHours(r.restaurantId),
            reportRepository.getOccupancyByHour(r),
        ]);
        const hoursPerDay = new Map(hours.map((h) => [h.id, num(h.hours_per_day)]));

        const byRoom = rooms.map((room) =>
            ({
                room_id: room.room_id,
                room_name: room.room_name,
                restaurant_id: room.restaurant_id,
                ...occupancyGroup(
                    room.table_count,
                    num(room.occupied_hours),
                    room.table_count * (hoursPerDay.get(room.restaurant_id) ?? 0) * days,
                    room.sessions,
                ),
            }),
        );

        const byRestaurant = hours.map((h) => {
            const own = byRoom.filter((room) => room.restaurant_id === h.id);
            const tables = own.reduce((acc, room) => acc + room.table_count, 0);
            return {
                restaurant_id: h.id,
                restaurant_name: h.name,
                open_time: h.open_time,
                close_time: h.close_time,
                ...occupancyGroup(
                    tables,
                    own.reduce((acc, room) => acc + room.occupied_hours, 0),
                    own.reduce((acc, room) => acc + room.available_hours, 0),
                    own.reduce((acc, room) => acc + room.sessions, 0),
                ),
            };
        });

        const totalTables = byRestaurant.reduce((acc, x) => acc + x.table_count, 0);
        const hourMap = new Map(byHour.map((h) => [h.hour, num(h.occupied_hours)]));
        const slots = totalTables * days;

        return {
            days,
            summary: occupancyGroup(
                totalTables,
                byRestaurant.reduce((acc, x) => acc + x.occupied_hours, 0),
                byRestaurant.reduce((acc, x) => acc + x.available_hours, 0),
                byRestaurant.reduce((acc, x) => acc + x.sessions, 0),
            ),
            by_restaurant: byRestaurant,
            by_room: byRoom,
            by_hour: Array.from({ length: 24 }, (_, hour) => {
                const occupied = hourMap.get(hour) ?? 0;
                return {
                    hour,
                    occupied_hours: round2(occupied),
                    avg_occupancy: slots > 0 ? Math.round((occupied / slots) * 10000) / 10000 : null,
                };
            }),
        };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};

/** Tiền tip theo kỳ và theo nhân viên nhận (không tính vào doanh thu) */
export const getTipsReport = async (r: IReportRange, groupBy: ReportGroupBy): Promise<ITipsReport | number> => {
    try {
        const [periods, rows, staff] = await Promise.all([
            reportRepository.getPeriods(r, groupBy),
            reportRepository.getTipsByPeriod(r, groupBy),
            reportRepository.getTipsByStaff(r),
        ]);
        const byPeriod = new Map(rows.map((row) => [row.period, num(row.tip_total)]));
        return {
            group_by: groupBy,
            total: round2(staff.reduce((acc, x) => acc + num(x.tip_total), 0)),
            series: periods.map((period) => ({ period, tip_total: round2(byPeriod.get(period) ?? 0) })),
            by_staff: staff.map((row) => ({
                staff_id: row.staff_id ?? null,
                full_name: row.full_name ?? null,
                tip_total: round2(num(row.tip_total)),
                payments: num(row.payments),
                orders: num(row.orders),
            })),
        };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};

/** Giá trị nhập / xuất / kiểm kê theo kỳ, nguyên liệu nhập nhiều nhất, theo nhà cung cấp */
export const getInventoryReport = async (r: IReportRange, groupBy: ReportGroupBy, limit: number): Promise<IInventoryReport | number> => {
    try {
        const [periods, rows, top, suppliers] = await Promise.all([
            reportRepository.getPeriods(r, groupBy),
            reportRepository.getReceiptsByPeriod(r, groupBy),
            reportRepository.getTopImportedIngredients(r, limit),
            reportRepository.getImportsBySupplier(r, limit),
        ]);
        const byPeriod = new Map(rows.map((row) => [row.period, row]));
        const series = periods.map((period) => {
            const row = byPeriod.get(period);
            return {
                period,
                import_value: num(row?.import_value),
                export_value: num(row?.export_value),
                adjust_value: num(row?.adjust_value),
                receipts: num(row?.receipts),
            };
        });
        return {
            group_by: groupBy,
            series,
            totals: {
                import_value: round2(rows.reduce((acc, x) => acc + num(x.import_value), 0)),
                export_value: round2(rows.reduce((acc, x) => acc + num(x.export_value), 0)),
                adjust_value: round2(rows.reduce((acc, x) => acc + num(x.adjust_value), 0)),
                import_receipts: rows.reduce((acc, x) => acc + num(x.import_receipts), 0),
            },
            top_ingredients: top.map((row) => ({
                ingredient_id: num(row.ingredient_id),
                name: String(row.name),
                unit: String(row.unit),
                quantity: num(row.quantity),
                value: round2(num(row.value)),
            })),
            by_supplier: suppliers.map((row) => ({
                supplier: row.supplier ?? null,
                value: round2(num(row.value)),
                receipts: num(row.receipts),
            })),
        };
    } catch (error) {
        return REPORT_ERROR.FAILED;
    }
};
