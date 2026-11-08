import { KitchenStationEnum, OrderItemStatusEnum, OrderStatusEnum, ReservationStatusEnum, UsageStatusEnum } from "~/common/enum";
import { ORDER_ERROR } from "~/common/error-code/order";
import { OrderItemPermissionEnum, OrderPermissionEnum } from "~/common/permission-enum";
import { rollback, withTransaction } from "~/config/db";
import {
    IBatchLineStatusBody,
    ICreateOrderBody,
    ICreateRoundBody,
    ISplitOrderBody,
    IGetOrders,
    IAuditContext,
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
import { AUDIT_ACTION, writeAudit } from "~/utils/audit";
import { inScope } from "./room.service";
import { consumeServedLines } from "./recipe.service";
import { IConsumeResult } from "~/interfaces";

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
    /** Tỷ lệ phí / thuế (mặc định lấy cấu hình hiện tại của nhà hàng; order tách ra thì giữ tỷ lệ của order gốc) */
    rates?: { service_fee_rate: string | number; tax_rate: string | number };
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
        service_fee_rate: input.rates?.service_fee_rate ?? restaurant?.service_fee_percent ?? 0,
        tax_rate: input.rates?.tax_rate ?? restaurant?.tax_percent ?? 0,
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

type LockedLine = NonNullable<Awaited<ReturnType<typeof orderRepository.getLineForUpdate>>>;

/** Một dòng món vừa đổi trạng thái, dùng để phát sự kiện sau commit */
interface IChangedLine {
    kind: OrderLineKind;
    line: LockedLine;
}

/**
 * Chuyển một dòng món (đã khóa) sang `body.status` theo `LINE_TRANSITIONS`, kiểm tra quyền theo từng bước.
 * Hủy món thì tính lại tiền và ghi audit log. Gọi trong transaction.
 */
const transitionLine = async (kind: OrderLineKind, line: LockedLine, body: IUpdateLineStatusBody, actor: IOrderActor) => {
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
    await orderRepository.updateLine(kind, line.id, row);
    if (body.status === I.CANCELLED) {
        await orderRepository.recomputeTotals(line.order_id);
        await writeAudit(actor.audit ?? { userId: actor.id }, {
            action: AUDIT_ACTION.ORDER_ITEM_CANCEL,
            entity_type: kind === "dish" ? "order_item" : "order_combo",
            entity_id: line.id,
            restaurant_id: line.restaurant_id,
            before: { status: line.status, quantity: line.quantity, current_price: line.current_price },
            after: {
                status: I.CANCELLED,
                cancel_reason: body.cancel_reason ?? null,
                order_id: line.order_id,
                order_code: line.order_code,
            },
        });
    }
};

/**
 * Món vừa chuyển sang `served` thì trừ kho theo định lượng (giai đoạn 10), cùng transaction với đổi trạng thái.
 * Gọi một lần cho cả lô để khóa tồn kho đúng một lần.
 */
const consumeIfServed = (changed: IChangedLine[], status: OrderItemStatusEnum, actor: IOrderActor) =>
    status === I.SERVED
        ? consumeServedLines(
              changed.map(({ kind, line }) => ({ kind, id: line.id, restaurant_id: line.restaurant_id })),
              actor.id,
          )
        : Promise.resolve([] as IConsumeResult[]);

const emitInventory = (results: IConsumeResult[]) =>
    results.forEach((r) => emitToRestaurant(r.restaurant_id, "inventory:changed", r));

/** Phát sự kiện cho các dòng vừa đổi trạng thái (sau commit); hủy món thì order đổi tiền */
const emitLinesChanged = async (changed: IChangedLine[], status: OrderItemStatusEnum) => {
    for (const { kind, line } of changed) {
        emitToRestaurant(line.restaurant_id, "order_item:status_changed", {
            restaurant_id: line.restaurant_id,
            order_id: line.order_id,
            line_id: line.id,
            kind,
            status,
            station: line.station,
        });
    }
    if (status !== I.CANCELLED) return;
    for (const orderId of new Set(changed.map((c) => c.line.order_id))) {
        const order = await orderRepository.getOrderRow(orderId);
        if (order) emitOrderUpdated(order);
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
            await transitionLine(kind, line, body, actor);
            const consumed = await consumeIfServed([{ kind, line }], body.status, actor);
            return { line, consumed };
        });
        if (typeof result === "number") return result;
        await emitLinesChanged([{ kind, line: result.line }], body.status);
        emitInventory(result.consumed);
        return { id: lineId, kind, order_id: result.line.order_id, status: body.status };
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/**
 * Đổi trạng thái nhiều dòng một lần (tất cả cùng thành công hoặc cùng bị hủy):
 * - `lines`: đúng các dòng này; dòng nào không chuyển được sang `status` thì báo lỗi cả lô.
 * - `round_id`: mọi dòng của đợt gọi món chuyển được sang `status` (lọc thêm `station` nếu có); dòng đã ở bước khác thì bỏ qua.
 */
export const updateLinesStatus = async (
    body: IBatchLineStatusBody,
    scope: Scope,
    actor: IOrderActor,
): Promise<{ status: OrderItemStatusEnum; lines: { kind: OrderLineKind; id: number; order_id: number }[] } | number> => {
    try {
        const result = await withTransaction(async () => {
            let refs: { kind: OrderLineKind; id: number }[] = body.lines ?? [];
            const fromRound = !!body.round_id;
            if (body.round_id) {
                const round = await orderRepository.getRoundById(body.round_id);
                if (!round) return rollback(ORDER_ERROR.ITEM_NOT_FOUND);
                refs = await orderRepository.getRoundLineRefs(round.id);
            }
            // Khóa order trước (theo id), rồi tới từng dòng (theo loại và id) để tránh deadlock
            for (const orderId of await orderRepository.getLineOrderIds(refs)) {
                const order = await orderRepository.getOrderRow(orderId, true);
                if (!order || !inScope(order.restaurant_id, scope)) return rollback(ORDER_ERROR.ITEM_NOT_FOUND);
            }
            const sorted = [...refs].sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
            const changed: IChangedLine[] = [];
            for (const ref of sorted) {
                const line = await orderRepository.getLineForUpdate(ref.kind, ref.id);
                if (!line || !inScope(line.restaurant_id, scope)) return rollback(ORDER_ERROR.ITEM_NOT_FOUND);
                if (fromRound) {
                    if (body.station && line.station !== body.station) continue;
                    if (!LINE_TRANSITIONS[line.status][body.status]) continue;
                }
                await transitionLine(ref.kind, line, body, actor);
                changed.push({ kind: ref.kind, line });
            }
            if (changed.length === 0) return rollback(ORDER_ERROR.NO_LINES_TO_UPDATE);
            const consumed = await consumeIfServed(changed, body.status, actor);
            return { changed, consumed };
        });
        if (typeof result === "number") return result;
        await emitLinesChanged(result.changed, body.status);
        emitInventory(result.consumed);
        return {
            status: body.status,
            lines: result.changed.map(({ kind, line }) => ({ kind, id: line.id, order_id: line.order_id })),
        };
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Gộp / tách order (câu hỏi 3)
// ---------------------------------------------------------------------------

/** Order đã thu tiền hoặc có giao dịch chờ thì không được gộp / tách món ra (tiền đã thu sẽ lệch với món) */
const checkNoPayments = async (orderId: number) => {
    const summary = await paymentRepository.getSummary(orderId);
    if (summary.paid !== 0 || summary.pending > 0) return rollback(ORDER_ERROR.SOURCE_HAS_PAYMENTS);
};

/** Khóa hai order theo thứ tự id (tránh deadlock khi hai thao tác ngược chiều chạy cùng lúc) */
const loadPair = async (sourceId: number, targetId: number, scope: Scope) => {
    if (sourceId === targetId) return rollback(ORDER_ERROR.SAME_ORDER);
    const [firstId, secondId] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
    const first = await orderRepository.getOrderRow(firstId, true);
    const second = await orderRepository.getOrderRow(secondId, true);
    const source = firstId === sourceId ? first : second;
    const target = firstId === sourceId ? second : first;
    if (!source || !inScope(source.restaurant_id, scope)) return rollback(ORDER_ERROR.NOT_FOUND);
    if (!target || target.restaurant_id !== source.restaurant_id) return rollback(ORDER_ERROR.TARGET_NOT_FOUND);
    if (!isOpen(source) || !isOpen(target)) return rollback(ORDER_ERROR.ORDER_CLOSED);
    return { source, target };
};

/** Order đích có món thì chuyển sang `serving` */
const markServing = async (order: IOrder) => {
    const counts = await orderRepository.countLinesByStatus(order.id);
    const hasLines = Object.values(counts).some((n) => (n ?? 0) > 0);
    if (hasLines && order.status !== OrderStatusEnum.SERVING) {
        await orderRepository.updateOrder(order.id, { status: OrderStatusEnum.SERVING });
        return OrderStatusEnum.SERVING;
    }
    return order.status;
};

/**
 * Gộp order `sourceId` vào `targetId` (khách hai bàn ngồi chung, thanh toán chung):
 * mọi đợt gọi món, dòng món và bàn chuyển sang order đích; số khách cộng dồn; order nguồn chuyển `merged`.
 * Order nguồn chưa được thu tiền. Mã giảm giá của order nguồn bị gỡ (trả lại lượt dùng).
 * Đặt bàn của order nguồn chuyển sang order đích nếu order đích chưa có, ngược lại được đánh dấu hoàn tất.
 */
export const mergeOrder = async (
    sourceId: number,
    targetId: number,
    scope: Scope,
    audit: IAuditContext,
): Promise<IOrderDetail | number> => {
    try {
        const result = await withTransaction(async () => {
            const { source, target } = await loadPair(sourceId, targetId, scope);
            await checkNoPayments(source.id);

            const removed = await discountRepository.removeOrderDiscount(source.id);
            if (removed) await discountRepository.changeUsage(removed.discount_id, -1);

            await orderRepository.moveAllRoundsAndLines(source.id, target.id);
            const now = new Date();
            const tables = await orderRepository.releaseOrderTables(source.id, undefined, now);
            await orderRepository.addOrderTables(target.id, tables);

            // Đặt bàn đi theo order đích (để hoàn tất cùng order đích); order đích đã có đặt bàn thì đóng đặt bàn nguồn
            let reservationId: number | null = null;
            if (source.reservation_id) {
                reservationId = source.reservation_id;
                await orderRepository.updateOrder(source.id, { reservation_id: null });
                if (!target.reservation_id) {
                    await orderRepository.updateOrder(target.id, { reservation_id: source.reservation_id });
                } else {
                    const reservation = await reservationRepository.getReservationById(source.reservation_id, true);
                    if (reservation?.status === ReservationStatusEnum.ARRIVED) {
                        await reservationRepository.updateReservation(reservation.id, {
                            status: ReservationStatusEnum.COMPLETED,
                            completed_at: now,
                        });
                    }
                }
            }

            await orderRepository.updateOrder(target.id, { guest_count: target.guest_count + source.guest_count });
            await orderRepository.updateOrder(source.id, {
                status: OrderStatusEnum.MERGED,
                merged_into_order_id: target.id,
            });
            await orderRepository.recomputeTotals(source.id);
            await orderRepository.recomputeTotals(target.id);
            const targetStatus = await markServing(target);

            await writeAudit(audit, {
                action: AUDIT_ACTION.ORDER_MERGE,
                entity_type: "order",
                entity_id: source.id,
                restaurant_id: source.restaurant_id,
                before: { code: source.code, status: source.status, total: source.total, discount_removed: removed?.discount_id ?? null },
                after: {
                    status: OrderStatusEnum.MERGED,
                    merged_into_order_id: target.id,
                    merged_into_code: target.code,
                    tables,
                },
            });
            return { source, target: { ...target, status: targetStatus }, reservationId };
        });
        if (typeof result === "number") return result;
        emitOrderUpdated({ ...result.source, status: OrderStatusEnum.MERGED });
        emitOrderUpdated(result.target);
        if (result.reservationId) {
            emitToRestaurant(result.source.restaurant_id, "reservation:changed", {
                restaurant_id: result.source.restaurant_id,
                reservation_id: result.reservationId,
            });
        }
        return (await loadDetail(targetId))!;
    } catch (error) {
        return ORDER_ERROR.FAILED;
    }
};

/**
 * Tách món sang order khác (tách hóa đơn, nhóm khách chia bàn):
 * - `target_order_id`: chuyển sang order đang mở có sẵn; hoặc
 * - `table_ids`: mở order mới trên các bàn này (bàn trống, hoặc bàn của order nguồn — order nguồn phải còn ít nhất một bàn).
 * Mỗi dòng chuyển được một phần số lượng. Dòng đã hủy giữ lại. Order nguồn chưa được thu tiền.
 * Ở order đích, mỗi đợt gốc thành một đợt mới giữ nguyên giờ gửi bếp.
 */
export const splitOrder = async (
    sourceId: number,
    body: ISplitOrderBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<{ source: IOrderDetail; target: IOrderDetail } | number> => {
    const actorId = audit.userId ?? null;
    try {
        let opened: IOpenedOrder | null = null;
        let movedTables: number[] = [];
        const result = await withTransaction(async () => {
            let source: IOrder;
            let target: IOrder;
            if (body.target_order_id) {
                ({ source, target } = await loadPair(sourceId, body.target_order_id, scope));
                await checkNoPayments(source.id);
            } else {
                source = await loadOrder(sourceId, scope);
                await checkNoPayments(source.id);
                // Bàn lấy từ order nguồn: trả khỏi order nguồn trước, rồi mở order mới trên toàn bộ bàn đã chọn
                const current = await orderRepository.getActiveTableIds(source.id);
                const tableIds = [...new Set(body.table_ids ?? [])];
                movedTables = tableIds.filter((t) => current.includes(t));
                if (movedTables.length > 0 && movedTables.length >= current.length) return rollback(ORDER_ERROR.LAST_TABLE);
                await orderRepository.releaseOrderTables(source.id, movedTables);
                opened = await openOrder({
                    restaurantId: source.restaurant_id,
                    tableIds,
                    guestCount: body.guest_count ?? 1,
                    note: body.note ?? null,
                    actorId,
                    rates: { service_fee_rate: source.service_fee_rate ?? 0, tax_rate: source.tax_rate ?? 0 },
                });
                target = (await orderRepository.getOrderRow(opened.id, true))!;
            }

            const targetTableId = (await orderRepository.getActiveTableIds(target.id))[0] ?? null;
            const rounds = new Map<number, number>();
            const moved: { kind: OrderLineKind; id: number; quantity: number; status: string }[] = [];
            const sorted = [...body.lines].sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
            for (const ref of sorted) {
                const line = await orderRepository.getLineForUpdate(ref.kind, ref.id);
                if (!line || line.order_id !== source.id) return rollback(ORDER_ERROR.INVALID_SPLIT_LINES);
                if (line.status === I.CANCELLED || ref.quantity > line.quantity) {
                    return rollback(ORDER_ERROR.INVALID_SPLIT_LINES);
                }
                const roundId = line.round_id;
                if (!rounds.has(roundId)) {
                    const original = (await orderRepository.getRoundById(roundId))!;
                    const created = await orderRepository.createRound({
                        order_id: target.id,
                        table_id: targetTableId,
                        note: original.note,
                        created_by: original.created_by,
                        sent_at: original.sent_at,
                    });
                    rounds.set(roundId, created.id);
                }
                await orderRepository.moveLine(ref.kind, line.id, line.quantity, ref.quantity, target.id, rounds.get(roundId)!);
                moved.push({ kind: ref.kind, id: line.id, quantity: ref.quantity, status: line.status });
            }

            await orderRepository.recomputeTotals(source.id);
            await orderRepository.recomputeTotals(target.id);
            const targetStatus = await markServing(target);

            await writeAudit(audit, {
                action: AUDIT_ACTION.ORDER_SPLIT,
                entity_type: "order",
                entity_id: source.id,
                restaurant_id: source.restaurant_id,
                before: { code: source.code, total: source.total },
                after: {
                    target_order_id: target.id,
                    target_order_code: target.code,
                    new_order: !body.target_order_id,
                    tables: movedTables,
                    lines: moved,
                },
            });
            return { source, target: { ...target, status: targetStatus } };
        });
        if (typeof result === "number") return result;

        if (opened) emitOrderOpened(opened);
        emitOrderUpdated(result.source);
        emitOrderUpdated(result.target);
        return { source: (await loadDetail(result.source.id))!, target: (await loadDetail(result.target.id))! };
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
    audit: IAuditContext,
): Promise<IOrderDetail | number> => {
    const actorId = audit.userId ?? undefined;
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
            await writeAudit(audit, {
                action: AUDIT_ACTION.ORDER_CANCEL,
                entity_type: "order",
                entity_id: id,
                restaurant_id: order.restaurant_id,
                before: { code: order.code, status: order.status, total: order.total, discount_removed: removed?.discount_id ?? null },
                after: { status: OrderStatusEnum.CANCELLED, cancel_reason: reason ?? null },
            });
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
