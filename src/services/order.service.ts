import { KitchenStationEnum, OrderItemStatusEnum, OrderStatusEnum, ReservationStatusEnum, UsageStatusEnum } from "~/common/enum";
import { ORDER_ERROR } from "~/common/error-code/order";
import { OrderItemPermissionEnum, OrderPermissionEnum } from "~/common/permission-enum";
import { rollback, withTransaction } from "~/config/db";
import {
    ICreateOrderBody,
    ICreateRoundBody,
    IGetOrders,
    IKitchenLine,
    IOrder,
    IOrderActor,
    IOrderDetail,
    IReservation,
    ISelectQuery,
    IUpdateLineStatusBody,
    IUpdateOrderBody,
    OrderLineKind,
} from "~/interfaces";
import {
    discountRepository,
    orderRepository,
    paymentRepository,
    reservationRepository,
    restaurantRepository,
} from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { buildPagination } from "~/utils/pagination";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const I = OrderItemStatusEnum;

/**
 * Máy trạng thái của món: trạng thái hiện tại -> trạng thái mới -> các quyền được phép (có một là đủ).
 * - Bếp / pha chế: xác nhận, bắt đầu làm, làm xong; được từ chối món chưa làm (hết nguyên liệu).
 * - Phục vụ: mang món ra (`served`); hủy món khi bếp chưa nhận.
 * - Hủy món đã bắt đầu làm cần `order.cancel` (giám sát / quản lý).
 */
const LINE_TRANSITIONS: Record<OrderItemStatusEnum, Partial<Record<OrderItemStatusEnum, string[]>>> = {
    [I.PENDING]: {
        [I.CONFIRMED]: [OrderItemPermissionEnum.PREPARE],
        [I.COOKING]: [OrderItemPermissionEnum.PREPARE],
        [I.CANCELLED]: [OrderPermissionEnum.UPDATE, OrderItemPermissionEnum.PREPARE],
    },
    [I.CONFIRMED]: {
        [I.COOKING]: [OrderItemPermissionEnum.PREPARE],
        [I.CANCELLED]: [OrderPermissionEnum.CANCEL, OrderItemPermissionEnum.PREPARE],
    },
    [I.COOKING]: {
        [I.READY]: [OrderItemPermissionEnum.PREPARE],
        [I.CANCELLED]: [OrderPermissionEnum.CANCEL],
    },
    [I.READY]: {
        [I.SERVED]: [OrderItemPermissionEnum.SERVE],
        [I.CANCELLED]: [OrderPermissionEnum.CANCEL],
    },
    [I.SERVED]: {},
    [I.CANCELLED]: {},
};

/** Cột thời gian được ghi khi chuyển sang trạng thái tương ứng */
const LINE_TIMESTAMP: Partial<Record<OrderItemStatusEnum, string>> = {
    [I.CONFIRMED]: "confirmed_at",
    [I.COOKING]: "cooking_at",
    [I.READY]: "ready_at",
    [I.SERVED]: "served_at",
    [I.CANCELLED]: "cancelled_at",
};

/** Món còn đang trong quy trình (chưa phục vụ, chưa hủy) */
const UNFINISHED_LINE_STATUSES: OrderItemStatusEnum[] = [I.PENDING, I.CONFIRMED, I.COOKING, I.READY];

const isOpen = (order: IOrder) => OPEN_ORDER_STATUSES.includes(order.status);

// ---------------------------------------------------------------------------
// Tiện ích (gọi trong transaction)
// ---------------------------------------------------------------------------

const resolveRestaurant = async (scope: Scope, requested?: number): Promise<number> => {
    const restaurantId = scope ?? requested;
    if (!restaurantId) return rollback(ORDER_ERROR.RESTAURANT_REQUIRED);
    const restaurant = await restaurantRepository.getRestaurantById(restaurantId);
    if (!restaurant) return rollback(ORDER_ERROR.RESTAURANT_NOT_FOUND);
    return restaurantId;
};

/** Khóa order; ngoài phạm vi coi như không tồn tại. `open`: bắt buộc order chưa đóng. */
const loadOrder = async (id: number, scope: Scope, open = true): Promise<IOrder> => {
    const order = await orderRepository.getOrderRow(id, true);
    if (!order || !inScope(order.restaurant_id, scope)) return rollback(ORDER_ERROR.NOT_FOUND);
    if (open && !isOpen(order)) return rollback(ORDER_ERROR.ORDER_CLOSED);
    return order;
};

/** Bàn hợp lệ (cùng nhà hàng, phòng đang hoạt động) và chưa thuộc order mở nào khác. Khóa các dòng bàn. */
const lockFreeTables = async (restaurantId: number, tableIds: number[], excludeOrderId?: number) => {
    const tables = await reservationRepository.getBookableTables(restaurantId, tableIds);
    if (tables.length !== tableIds.length) return rollback(ORDER_ERROR.INVALID_TABLES);
    const busy = await orderRepository.findBusyTables(tableIds, excludeOrderId);
    if (busy.length > 0) return rollback(ORDER_ERROR.TABLE_BUSY);
    return tables;
};

const checkGuest = async (guestUserId: number | null | undefined) => {
    if (guestUserId && !(await reservationRepository.getGuestById(guestUserId))) {
        return rollback(ORDER_ERROR.GUEST_NOT_FOUND);
    }
};

const checkStaff = async (staffId: number | null | undefined, restaurantId: number) => {
    if (!staffId) return;
    const staff = await orderRepository.getStaffById(staffId);
    // Admin (không thuộc nhà hàng nào) vẫn được phân công
    if (!staff || (staff.restaurant_id !== null && staff.restaurant_id !== restaurantId)) {
        return rollback(ORDER_ERROR.STAFF_NOT_FOUND);
    }
};

/** Kết quả mở order, dùng để phát sự kiện sau khi commit */
export interface IOpenedOrder {
    id: number;
    code: string;
    restaurant_id: number;
    table_ids: number[];
}

/**
 * Mở order: kiểm tra bàn, sinh mã, gắn bàn và chuyển bàn sang `occupied`. Gọi trong transaction.
 * Không kiểm tra số ghế: khách vãng lai có thể kê thêm ghế.
 */
const openOrder = async (input: {
    restaurantId: number;
    tableIds: number[];
    guestCount: number;
    guestUserId?: number | null;
    assignedStaffId?: number | null;
    note?: string | null;
    reservationId?: number | null;
    actorId?: number | null;
}): Promise<IOpenedOrder> => {
    const tableIds = [...new Set(input.tableIds)];
    await lockFreeTables(input.restaurantId, tableIds);
    await checkGuest(input.guestUserId);
    await checkStaff(input.assignedStaffId, input.restaurantId);

    const code = await orderRepository.nextOrderCode(input.restaurantId);
    const restaurant = await restaurantRepository.getRestaurantById(input.restaurantId);
    const created = await orderRepository.createOrder({
        code,
        restaurant_id: input.restaurantId,
        reservation_id: input.reservationId ?? null,
        guest_user_id: input.guestUserId ?? null,
        guest_count: input.guestCount,
        created_by: input.actorId ?? null,
        assigned_staff_id: input.assignedStaffId ?? input.actorId ?? null,
        status: OrderStatusEnum.CONFIRMED,
        note: input.note ?? null,
        service_fee_rate: restaurant?.service_fee_percent ?? 0,
        tax_rate: restaurant?.tax_percent ?? 0,
    });
    await orderRepository.addOrderTables(created.id, tableIds);
    await orderRepository.setTablesStatus(tableIds, UsageStatusEnum.OCCUPIED);
    return { id: created.id, code, restaurant_id: input.restaurantId, table_ids: tableIds };
};

/**
 * Mở order cho reservation khi khách đến (gọi từ reservation service, trong transaction).
 * Dùng bàn, số khách, khách và ghi chú của reservation.
 */
export const openOrderForReservation = async (reservation: IReservation, actorId?: number | null): Promise<IOpenedOrder> => {
    if (await orderRepository.getOrderByReservation(reservation.id)) return rollback(ORDER_ERROR.RESERVATION_HAS_ORDER);
    return openOrder({
        restaurantId: reservation.restaurant_id,
        tableIds: (reservation.tables || []).map((t) => t.id),
        guestCount: reservation.guest_count,
        guestUserId: reservation.guest_user_id,
        note: reservation.note,
        reservationId: reservation.id,
        actorId,
    });
};

/** Phát sự kiện mở order (sau commit) */
export const emitOrderOpened = (opened: IOpenedOrder) => {
    emitToRestaurant(opened.restaurant_id, "order:created", {
        restaurant_id: opened.restaurant_id,
        order_id: opened.id,
        code: opened.code,
        status: OrderStatusEnum.CONFIRMED,
    });
    emitToRestaurant(opened.restaurant_id, "table:status_changed", {
        restaurant_id: opened.restaurant_id,
        table_ids: opened.table_ids,
        status: UsageStatusEnum.OCCUPIED,
    });
};

const emitOrderUpdated = (order: Pick<IOrder, "id" | "code" | "restaurant_id" | "status">) =>
    emitToRestaurant(order.restaurant_id, "order:updated", {
        restaurant_id: order.restaurant_id,
        order_id: order.id,
        code: order.code,
        status: order.status,
    });

const emitTables = (restaurantId: number, tableIds: number[], status: UsageStatusEnum) => {
    if (tableIds.length === 0) return;
    emitToRestaurant(restaurantId, "table:status_changed", { restaurant_id: restaurantId, table_ids: tableIds, status });
};

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Order kèm các đợt gọi món và từng dòng món */
const loadDetail = async (id: number): Promise<IOrderDetail | undefined> => {
    const order = await orderRepository.getOrderById(id);
    if (!order) return undefined;
    const [rounds, lines, payments] = await Promise.all([
        orderRepository.getRounds(id),
        orderRepository.getLines(id),
        paymentRepository.getOrderPayments(id),
    ]);
    return {
        ...order,
        payments,
        rounds: rounds.map((r) => ({ ...r, lines: lines.filter((l) => l.round_id === r.id) })),
    };
};

export const getOrders = async (params: ISelectQuery, tableId?: number): Promise<IGetOrders | number> => {
    try {
        const conditions = tableId
            ? [`EXISTS (SELECT 1 FROM order_tables ot_f WHERE ot_f.order_id = o.id AND ot_f.table_id = ${Number(tableId)})`]
            : [];
        const result = await orderRepository.getOrders({ ...params, conditions });
        return { orders: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

export const getActiveOrders = async (scope: Scope, restaurantId?: number): Promise<IOrder[] | number> => {
    try {
        return await withTransaction(async () =>
            orderRepository.getActiveOrders(await resolveRestaurant(scope, restaurantId)),
        );
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

export const getOrderById = async (id: number, scope: Scope): Promise<IOrderDetail | number> => {
    try {
        const order = await loadDetail(id);
        if (!order || !inScope(order.restaurant_id, scope)) return ORDER_ERROR.NOT_FOUND;
        return order;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

export const getKitchenQueue = async (
    scope: Scope,
    restaurantId?: number,
    station?: string,
): Promise<IKitchenLine[] | number> => {
    try {
        return await withTransaction(async () =>
            orderRepository.getKitchenQueue(await resolveRestaurant(scope, restaurantId), station),
        );
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Mở / sửa order
// ---------------------------------------------------------------------------

export const createOrder = async (
    body: ICreateOrderBody,
    scope: Scope,
    actorId: number | undefined,
): Promise<IOrderDetail | number> => {
    try {
        let reservationId: number | null = null;
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            let tableIds = body.table_ids;
            let guestCount = body.guest_count;
            let guestUserId = body.guest_user_id;
            let note = body.note;

            if (body.reservation_id) {
                const reservation = await reservationRepository.getReservationById(body.reservation_id, true);
                if (!reservation || reservation.restaurant_id !== restaurantId) {
                    return rollback(ORDER_ERROR.RESERVATION_NOT_FOUND);
                }
                const usable: string[] = [ReservationStatusEnum.PENDING, ReservationStatusEnum.CONFIRMED, ReservationStatusEnum.ARRIVED];
                if (!usable.includes(reservation.status)) return rollback(ORDER_ERROR.RESERVATION_CLOSED);
                if (await orderRepository.getOrderByReservation(reservation.id)) {
                    return rollback(ORDER_ERROR.RESERVATION_HAS_ORDER);
                }
                tableIds ??= (reservation.tables || []).map((t) => t.id);
                guestCount ??= reservation.guest_count;
                if (guestUserId === undefined) guestUserId = reservation.guest_user_id;
                if (note === undefined) note = reservation.note;
                if (reservation.status !== ReservationStatusEnum.ARRIVED) {
                    await reservationRepository.updateReservation(reservation.id, {
                        status: ReservationStatusEnum.ARRIVED,
                        arrived_at: new Date(),
                    });
                }
                reservationId = reservation.id;
            }
            if (!tableIds?.length) return rollback(ORDER_ERROR.INVALID_TABLES);

            return await openOrder({
                restaurantId,
                tableIds,
                guestCount: guestCount ?? 1,
                guestUserId,
                assignedStaffId: body.assigned_staff_id,
                note,
                reservationId,
                actorId,
            });
        });
        if (typeof result === "number") return result;

        emitOrderOpened(result);
        if (reservationId) {
            emitToRestaurant(result.restaurant_id, "reservation:changed", {
                restaurant_id: result.restaurant_id,
                reservation_id: reservationId,
            });
        }
        return (await loadDetail(result.id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

export const updateOrder = async (id: number, body: IUpdateOrderBody, scope: Scope): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            if (body.guest_user_id !== undefined) await checkGuest(body.guest_user_id);
            if (body.assigned_staff_id !== undefined) await checkStaff(body.assigned_staff_id, order.restaurant_id);
            await orderRepository.updateOrder(id, body);
            return order;
        });
        if (typeof result === "number") return result;
        emitOrderUpdated(result);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Bàn
// ---------------------------------------------------------------------------

/** Ghép thêm bàn vào order (nhóm khách đông hơn dự kiến) */
export const addTables = async (id: number, tableIds: number[], scope: Scope): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const current = await orderRepository.getActiveTableIds(id);
            const added = [...new Set(tableIds)].filter((t) => !current.includes(t));
            await lockFreeTables(order.restaurant_id, added, id);
            await orderRepository.addOrderTables(id, added);
            await orderRepository.setTablesStatus(added, UsageStatusEnum.OCCUPIED);
            await orderRepository.updateOrder(id, {});
            return { order, added };
        });
        if (typeof result === "number") return result;
        emitOrderUpdated(result.order);
        emitTables(result.order.restaurant_id, result.added, UsageStatusEnum.OCCUPIED);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/** Chuyển bàn: trả `from` (chuyển sang `cleaning`), nhận `to` (chuyển sang `occupied`). Lịch sử đợt gọi món giữ nguyên. */
export const transferTable = async (
    id: number,
    fromTableId: number,
    toTableId: number,
    scope: Scope,
): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const current = await orderRepository.getActiveTableIds(id);
            if (!current.includes(fromTableId)) return rollback(ORDER_ERROR.TABLE_NOT_IN_ORDER);
            if (current.includes(toTableId)) return rollback(ORDER_ERROR.TABLE_BUSY);
            await lockFreeTables(order.restaurant_id, [toTableId], id);

            await orderRepository.releaseOrderTables(id, [fromTableId]);
            await orderRepository.addOrderTables(id, [toTableId]);
            await orderRepository.setTablesStatus([fromTableId], UsageStatusEnum.CLEANING);
            await orderRepository.setTablesStatus([toTableId], UsageStatusEnum.OCCUPIED);
            await orderRepository.updateOrder(id, {});
            return order;
        });
        if (typeof result === "number") return result;
        emitOrderUpdated(result);
        emitTables(result.restaurant_id, [fromTableId], UsageStatusEnum.CLEANING);
        emitTables(result.restaurant_id, [toTableId], UsageStatusEnum.OCCUPIED);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/** Trả một bàn (khách dồn bàn); order phải còn ít nhất một bàn */
export const releaseTable = async (id: number, tableId: number, scope: Scope): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const current = await orderRepository.getActiveTableIds(id);
            if (!current.includes(tableId)) return rollback(ORDER_ERROR.TABLE_NOT_IN_ORDER);
            if (current.length === 1) return rollback(ORDER_ERROR.LAST_TABLE);
            await orderRepository.releaseOrderTables(id, [tableId]);
            await orderRepository.setTablesStatus([tableId], UsageStatusEnum.CLEANING);
            await orderRepository.updateOrder(id, {});
            return order;
        });
        if (typeof result === "number") return result;
        emitOrderUpdated(result);
        emitTables(result.restaurant_id, [tableId], UsageStatusEnum.CLEANING);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Gọi món
// ---------------------------------------------------------------------------

/**
 * Gửi một đợt gọi món cho một bàn của order. Giá lấy theo giá đang bán tại chi nhánh (`current_price`).
 * Món ngừng bán / chi nhánh đang tắt -> từ chối cả đợt.
 */
export const addRound = async (
    id: number,
    body: ICreateRoundBody,
    scope: Scope,
    actorId: number | undefined,
): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const current = await orderRepository.getActiveTableIds(id);
            const tableId = body.table_id ?? current[0];
            if (!tableId || !current.includes(tableId)) return rollback(ORDER_ERROR.TABLE_NOT_IN_ORDER);

            const items = body.items || [];
            const combos = body.combos || [];
            const [dishPrices, comboPrices] = await Promise.all([
                orderRepository.getSellableItems("dish", order.restaurant_id, [...new Set(items.map((i) => i.dish_id))]),
                orderRepository.getSellableItems("combo", order.restaurant_id, [...new Set(combos.map((c) => c.combo_id))]),
            ]);
            const dishMap = new Map(dishPrices.map((d) => [d.id, d]));
            const comboMap = new Map(comboPrices.map((c) => [c.id, c]));
            if (items.some((i) => !dishMap.has(i.dish_id)) || combos.some((c) => !comboMap.has(c.combo_id))) {
                return rollback(ORDER_ERROR.ITEM_UNAVAILABLE);
            }

            const round = await orderRepository.createRound({
                order_id: id,
                table_id: tableId,
                note: body.note ?? null,
                created_by: actorId ?? null,
            });
            const dishLines = items.map((i) => ({
                item_id: i.dish_id,
                quantity: i.quantity,
                note: i.note ?? null,
                price: dishMap.get(i.dish_id)!.price,
                station: dishMap.get(i.dish_id)!.station,
            }));
            const comboLines = combos.map((c) => ({
                item_id: c.combo_id,
                quantity: c.quantity,
                note: c.note ?? null,
                price: comboMap.get(c.combo_id)!.price,
                station: comboMap.get(c.combo_id)!.station,
            }));
            await orderRepository.insertLines("dish", id, round.id, dishLines);
            await orderRepository.insertLines("combo", id, round.id, comboLines);
            await orderRepository.recomputeTotals(id);

            const status = OrderStatusEnum.SERVING;
            if (order.status !== status) await orderRepository.updateOrder(id, { status });

            const stations = [...new Set([...dishLines, ...comboLines].map((l) => l.station as KitchenStationEnum))];
            return { order: { ...order, status }, round, stations };
        });
        if (typeof result === "number") return result;

        const { order, round, stations } = result;
        emitToRestaurant(order.restaurant_id, "order:round_sent", {
            restaurant_id: order.restaurant_id,
            order_id: order.id,
            code: order.code,
            round_id: round.id,
            round_no: round.round_no,
            stations,
        });
        emitOrderUpdated(order);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/** Đổi trạng thái một dòng món / combo theo `LINE_TRANSITIONS` (kiểm tra quyền theo từng bước). */
export const updateLineStatus = async (
    kind: OrderLineKind,
    lineId: number,
    body: IUpdateLineStatusBody,
    scope: Scope,
    actor: IOrderActor,
): Promise<{ id: number; kind: OrderLineKind; order_id: number; status: OrderItemStatusEnum } | number> => {
    try {
        const result = await withTransaction(async () => {
            const line = await orderRepository.getLineForUpdate(kind, lineId);
            if (!line || !inScope(line.restaurant_id, scope)) return rollback(ORDER_ERROR.ITEM_NOT_FOUND);
            if (!OPEN_ORDER_STATUSES.includes(line.order_status)) return rollback(ORDER_ERROR.ORDER_CLOSED);

            const allowed = LINE_TRANSITIONS[line.status][body.status];
            if (!allowed) return rollback(ORDER_ERROR.INVALID_TRANSITION);
            if (!allowed.some((p) => actor.permissions.includes(p))) return rollback(ORDER_ERROR.TRANSITION_FORBIDDEN);

            const now = new Date();
            const row: Record<string, unknown> = { status: body.status };
            const stampCol = LINE_TIMESTAMP[body.status];
            if (stampCol) row[stampCol] = now;
            // Bỏ qua bước "đã nhận": vẫn ghi mốc nhận món
            if (body.status === I.COOKING && line.status === I.PENDING) row.confirmed_at = now;
            if (body.status === I.CANCELLED) {
                row.cancelled_by = actor.id;
                row.cancel_reason = body.cancel_reason ?? null;
            }
            await orderRepository.updateLine(kind, lineId, row);
            if (body.status === I.CANCELLED) await orderRepository.recomputeTotals(line.order_id);
            const order = await orderRepository.getOrderRow(line.order_id);
            return { line, order: order! };
        });
        if (typeof result === "number") return result;

        const { line, order } = result;
        emitToRestaurant(line.restaurant_id, "order_item:status_changed", {
            restaurant_id: line.restaurant_id,
            order_id: line.order_id,
            line_id: lineId,
            kind,
            status: body.status,
            station: line.station,
        });
        if (body.status === I.CANCELLED) emitOrderUpdated(order);
        return { id: lineId, kind, order_id: line.order_id, status: body.status };
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Đóng order
// ---------------------------------------------------------------------------

/** Đóng order: trả bàn (-> `cleaning`) và cập nhật reservation liên kết (nếu khách đang ngồi). */
const closeOrder = async (
    order: IOrder,
    status: OrderStatusEnum.COMPLETED | OrderStatusEnum.CANCELLED,
    extra: { actorId?: number | null; reason?: string | null },
) => {
    const now = new Date();
    const released = await orderRepository.releaseOrderTables(order.id, undefined, now);
    await orderRepository.setTablesStatus(released, UsageStatusEnum.CLEANING);
    await orderRepository.updateOrder(
        order.id,
        status === OrderStatusEnum.COMPLETED
            ? { status, completed_at: now }
            : { status, cancelled_at: now, cancelled_by: extra.actorId ?? null, cancel_reason: extra.reason ?? null },
    );

    let reservationId: number | null = null;
    if (order.reservation_id) {
        const reservation = await reservationRepository.getReservationById(order.reservation_id, true);
        if (reservation?.status === ReservationStatusEnum.ARRIVED) {
            await reservationRepository.updateReservation(
                reservation.id,
                status === OrderStatusEnum.COMPLETED
                    ? { status: ReservationStatusEnum.COMPLETED, completed_at: now }
                    : { status: ReservationStatusEnum.CANCELLED, cancelled_at: now, cancel_reason: extra.reason ?? null },
            );
            reservationId = reservation.id;
        }
    }
    return { released, reservationId };
};

/** Kết quả đóng order, dùng để phát sự kiện sau khi commit */
export type IClosedOrder = Awaited<ReturnType<typeof closeOrder>>;

export const emitClosed = (
    order: IOrder,
    status: OrderStatusEnum,
    closed: { released: number[]; reservationId: number | null },
) => {
    emitOrderUpdated({ ...order, status });
    emitTables(order.restaurant_id, closed.released, UsageStatusEnum.CLEANING);
    if (closed.reservationId) {
        emitToRestaurant(order.restaurant_id, "reservation:changed", {
            restaurant_id: order.restaurant_id,
            reservation_id: closed.reservationId,
        });
    }
};

/**
 * Điều kiện hoàn tất: mọi món đã phục vụ hoặc đã hủy, đã thu đủ tiền, không còn giao dịch chờ xác nhận.
 * Trả về mã lỗi, hoặc undefined nếu đủ điều kiện. Gọi trong transaction, sau khi đã khóa order.
 */
const checkSettled = async (order: IOrder): Promise<number | undefined> => {
    const counts = await orderRepository.countLinesByStatus(order.id);
    if (UNFINISHED_LINE_STATUSES.some((s) => (counts[s] ?? 0) > 0)) return ORDER_ERROR.ITEMS_NOT_SERVED;
    const summary = await paymentRepository.getSummary(order.id);
    if (summary.pending > 0) return ORDER_ERROR.PENDING_PAYMENTS;
    const fresh = await orderRepository.getOrderRow(order.id);
    if (summary.paid < Number(fresh!.total)) return ORDER_ERROR.NOT_FULLY_PAID;
    return undefined;
};

/**
 * Tự hoàn tất order nếu đã đủ điều kiện (gọi từ thanh toán, trong transaction).
 * Trả về thông tin đóng order để phát sự kiện, hoặc null nếu chưa đủ điều kiện.
 */
export const completeIfSettled = async (order: IOrder): Promise<IClosedOrder | null> => {
    if (!isOpen(order) || (await checkSettled(order)) !== undefined) return null;
    return closeOrder(order, OrderStatusEnum.COMPLETED, {});
};

/** Hoàn tất order: món đã phục vụ / hủy hết và đã thu đủ tiền (đặc tả 8.7). */
export const completeOrder = async (id: number, scope: Scope): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const error = await checkSettled(order);
            if (error !== undefined) return rollback(error);
            return { order, closed: await closeOrder(order, OrderStatusEnum.COMPLETED, {}) };
        });
        if (typeof result === "number") return result;
        emitClosed(result.order, OrderStatusEnum.COMPLETED, result.closed);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/**
 * Hủy order: chỉ khi chưa phục vụ món nào và chưa thu tiền (đã thu thì phải hoàn trước).
 * Mọi món còn lại chuyển sang `cancelled`, giao dịch chờ bị hủy, mã giảm giá được trả lại lượt dùng.
 */
export const cancelOrder = async (
    id: number,
    reason: string | null | undefined,
    scope: Scope,
    actorId: number | undefined,
): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const counts = await orderRepository.countLinesByStatus(id);
            if ((counts[I.SERVED] ?? 0) > 0) return rollback(ORDER_ERROR.HAS_SERVED_ITEMS);
            if ((await paymentRepository.getSummary(id)).paid > 0) return rollback(ORDER_ERROR.HAS_PAYMENTS);
            await paymentRepository.cancelPendingPayments(id);
            const removed = await discountRepository.removeOrderDiscount(id);
            if (removed) await discountRepository.changeUsage(removed.discount_id, -1);
            await orderRepository.cancelOpenLines(id, actorId ?? null, reason ?? null);
            await orderRepository.recomputeTotals(id);
            return {
                order,
                closed: await closeOrder(order, OrderStatusEnum.CANCELLED, { actorId, reason }),
            };
        });
        if (typeof result === "number") return result;
        emitClosed(result.order, OrderStatusEnum.CANCELLED, result.closed);
        return (await loadDetail(id))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};
