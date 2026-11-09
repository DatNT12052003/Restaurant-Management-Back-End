import { MAX_RESERVATION_HOURS, PG_ERROR, RESERVATION_PAST_GRACE_MINUTES } from "~/common/constant";
import { ReservationStatusEnum, UsageStatusEnum } from "~/common/enum";
import { RESERVATION_ERROR } from "~/common/error-code/reservation";
import { rollback, withTransaction } from "~/config/db";
import {
    IAvailableTable,
    IAvailableTables,
    IAvailableTablesQuery,
    ICreateReservationBody,
    IGetReservations,
    IReservation,
    IReservationRow,
    IScheduleQuery,
    ISelectQuery,
    IUpdateReservationBody,
    IUpdateReservationStatusBody,
} from "~/interfaces";
import { orderRepository, reservationRepository, restaurantRepository } from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { ORDER_ERROR } from "~/common/error-code/order";
import * as orderService from "./order.service";
import { IOpenedOrder } from "./order.service";
import { getPgErrorCode } from "~/utils/common";
import logger from "~/config/logger";
import { AUDIT_ACTION, writeAudit } from "~/utils/audit";
import { buildPagination } from "~/utils/pagination";
import { inScope } from "./room.service";
import { notifyOnlineBooking } from "./booking-mail";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const S = ReservationStatusEnum;

/** Máy trạng thái của reservation: trạng thái hiện tại -> các trạng thái được chuyển tới */
const TRANSITIONS: Record<ReservationStatusEnum, ReservationStatusEnum[]> = {
    [S.PENDING]: [S.CONFIRMED, S.ARRIVED, S.CANCELLED, S.NO_SHOW],
    [S.CONFIRMED]: [S.ARRIVED, S.CANCELLED, S.NO_SHOW],
    [S.ARRIVED]: [S.COMPLETED],
    [S.COMPLETED]: [],
    [S.CANCELLED]: [],
    [S.NO_SHOW]: [],
};

/** Chỉ sửa thông tin đặt bàn khi khách chưa đến */
const EDITABLE_STATUSES: ReservationStatusEnum[] = [S.PENDING, S.CONFIRMED];

const toReservationError = (error: unknown): number =>
    getPgErrorCode(error) === PG_ERROR.EXCLUSION_VIOLATION ? RESERVATION_ERROR.TABLE_CONFLICT : RESERVATION_ERROR.FAILED;

const isStartInPast = (start: Date) => start.getTime() < Date.now() - RESERVATION_PAST_GRACE_MINUTES * 60 * 1000;

/** Nhà hàng của thao tác: người bị giới hạn luôn dùng nhà hàng của mình; admin phải chỉ định. */
const resolveRestaurant = async (scope: Scope, requested?: number): Promise<number> => {
    const restaurantId = scope ?? requested;
    if (!restaurantId) return rollback(RESERVATION_ERROR.RESTAURANT_REQUIRED);
    const restaurant = await restaurantRepository.getRestaurantById(restaurantId);
    if (!restaurant) return rollback(RESERVATION_ERROR.RESTAURANT_NOT_FOUND);
    return restaurantId;
};

/** Lấy reservation trong phạm vi; ngoài phạm vi coi như không tồn tại. Gọi trong transaction. */
const loadReservation = async (id: number, scope: Scope, forUpdate = false): Promise<IReservation> => {
    const reservation = await reservationRepository.getReservationById(id, forUpdate);
    if (!reservation || !inScope(reservation.restaurant_id, scope)) return rollback(RESERVATION_ERROR.NOT_FOUND);
    return reservation;
};

/**
 * Kiểm tra bàn: thuộc nhà hàng, phòng đang hoạt động, đủ chỗ cho số khách và không trùng lịch.
 * Gọi trong transaction (khóa các dòng bàn). Exclusion constraint trong DB là lớp chặn cuối cùng.
 */
const checkTables = async (input: {
    restaurantId: number;
    tableIds: number[];
    guestCount: number;
    start: Date;
    end: Date;
    excludeReservationId?: number;
}): Promise<void> => {
    const tables = await reservationRepository.getBookableTables(input.restaurantId, input.tableIds);
    if (tables.length !== input.tableIds.length) return rollback(RESERVATION_ERROR.INVALID_TABLES);

    const seats = tables.reduce((sum, t) => sum + t.capacity, 0);
    if (seats < input.guestCount) return rollback(RESERVATION_ERROR.INSUFFICIENT_CAPACITY);

    const conflicts = await reservationRepository.findConflictingTables(
        input.tableIds,
        input.start,
        input.end,
        input.excludeReservationId,
    );
    if (conflicts.length > 0) return rollback(RESERVATION_ERROR.TABLE_CONFLICT);
};

/** Thông tin liên hệ: ưu tiên dữ liệu nhập tay, thiếu thì lấy từ hồ sơ khách. */
const resolveContact = async (
    guestUserId: number | null | undefined,
    name: string | null | undefined,
    phone: string | null | undefined,
): Promise<{ contact_name: string; contact_phone: string }> => {
    let contactName = name || undefined;
    let contactPhone = phone || undefined;
    if (guestUserId) {
        const guest = await reservationRepository.getGuestById(guestUserId);
        if (!guest) return rollback(RESERVATION_ERROR.GUEST_NOT_FOUND);
        contactName ??= guest.full_name;
        contactPhone ??= guest.phone_number || undefined;
    }
    if (!contactName || !contactPhone) return rollback(RESERVATION_ERROR.CONTACT_REQUIRED);
    return { contact_name: contactName, contact_phone: contactPhone };
};

/**
 * Gợi ý bàn cho `guestCount` khách:
 * 1. Một bàn nhỏ nhất vẫn đủ chỗ.
 * 2. Không có thì ghép bàn trong cùng một phòng (ít bàn nhất, dư ít ghế nhất).
 */
export const suggestTables = (tables: IAvailableTable[], guestCount?: number): number[] => {
    if (!guestCount || tables.length === 0) return [];

    const single = tables
        .filter((t) => t.capacity >= guestCount)
        .sort((a, b) => a.capacity - b.capacity || a.id - b.id)[0];
    if (single) return [single.id];

    const byRoom = new Map<number, IAvailableTable[]>();
    tables.forEach((t) => byRoom.set(t.room_id, [...(byRoom.get(t.room_id) || []), t]));

    let best: { ids: number[]; excess: number } | null = null;
    for (const roomTables of byRoom.values()) {
        const sorted = [...roomTables].sort((a, b) => b.capacity - a.capacity || a.id - b.id);
        const picked: IAvailableTable[] = [];
        let seats = 0;
        for (const t of sorted) {
            if (seats >= guestCount) break;
            picked.push(t);
            seats += t.capacity;
        }
        if (seats < guestCount) continue;
        // Bỏ bớt bàn lớn nếu bàn nhỏ hơn vẫn đủ: thử thay bàn cuối bằng bàn nhỏ nhất còn đủ
        const rest = seats - picked[picked.length - 1].capacity;
        const lastFit = sorted
            .filter((t) => !picked.slice(0, -1).includes(t) && rest + t.capacity >= guestCount)
            .sort((a, b) => a.capacity - b.capacity)[0];
        if (lastFit) {
            picked[picked.length - 1] = lastFit;
            seats = rest + lastFit.capacity;
        }
        const candidate = { ids: picked.map((t) => t.id), excess: seats - guestCount };
        if (
            !best ||
            candidate.ids.length < best.ids.length ||
            (candidate.ids.length === best.ids.length && candidate.excess < best.excess)
        ) {
            best = candidate;
        }
    }
    return best?.ids ?? [];
};

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** `tableId`: chỉ lấy reservation có giữ bàn này (controller đã kiểm tra là số nguyên dương). */
export const getReservations = async (params: ISelectQuery, tableId?: number): Promise<IGetReservations | number> => {
    try {
        const conditions = tableId
            ? [`EXISTS (SELECT 1 FROM reservation_tables rt_f WHERE rt_f.reservation_id = rs.id AND rt_f.table_id = ${Number(tableId)})`]
            : [];
        const result = await reservationRepository.getReservations({ ...params, conditions });
        return { reservations: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return RESERVATION_ERROR.FAILED;
    }
};

export const getSchedule = async (
    query: Omit<IScheduleQuery, "restaurantId"> & { restaurantId?: number },
    scope: Scope,
): Promise<IReservation[] | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, query.restaurantId);
            return await reservationRepository.getSchedule(restaurantId, query.from, query.to);
        });
    } catch (error) {
        return RESERVATION_ERROR.FAILED;
    }
};

export const getReservationById = async (id: number, scope: Scope): Promise<IReservation | number> => {
    try {
        const reservation = await reservationRepository.getReservationById(id);
        if (!reservation || !inScope(reservation.restaurant_id, scope)) return RESERVATION_ERROR.NOT_FOUND;
        return reservation;
    } catch (error) {
        return RESERVATION_ERROR.FAILED;
    }
};

export const getAvailableTables = async (
    query: Omit<IAvailableTablesQuery, "restaurantId"> & { restaurantId?: number },
    scope: Scope,
): Promise<IAvailableTables | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, query.restaurantId);
            const tables = await reservationRepository.getAvailableTables(
                restaurantId,
                query.start_time,
                query.end_time,
                query.room_type,
                query.exclude_reservation_id,
            );
            return { tables, suggested_table_ids: suggestTables(tables, query.guest_count) };
        });
    } catch (error) {
        return RESERVATION_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Ghi
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tự giữ bàn / tự đánh dấu không đến (câu hỏi 8)
// ---------------------------------------------------------------------------

/** Gom id bàn theo nhà hàng để phát một sự kiện cho mỗi nhà hàng */
const groupByRestaurant = (rows: { id: number; restaurant_id: number }[]) => {
    const map = new Map<number, number[]>();
    rows.forEach((r) => map.set(r.restaurant_id, [...(map.get(r.restaurant_id) || []), r.id]));
    return map;
};

/**
 * Đồng bộ trạng thái bàn với lịch đặt bàn (job mỗi phút, và ngay sau mỗi lần sửa đặt bàn):
 * 1. Khách trễ quá `no_show_after_minutes` -> reservation `no_show` (ghi nhật ký, người thao tác "system").
 * 2. Trả các bàn đã giữ mà reservation không còn giữ -> `available`.
 * 3. Giữ bàn cho reservation trong khoảng `reservation_hold_minutes` trước giờ hẹn -> `reserved`.
 * `restaurantId` null = mọi nhà hàng. Trả về số thay đổi.
 */
export const syncReservationHolds = async (restaurantId: number | null = null) => {
    const result = await withTransaction(async () => {
        await reservationRepository.lockHoldSync();
        const noShows = await reservationRepository.markOverdueNoShows(restaurantId);
        for (const r of noShows) {
            await writeAudit(
                {},
                {
                    action: AUDIT_ACTION.RESERVATION_AUTO_NO_SHOW,
                    entity_type: "reservation",
                    entity_id: r.id,
                    restaurant_id: r.restaurant_id,
                    actor_name: "system",
                    before: { status: r.old_status },
                    after: { status: S.NO_SHOW, no_show_after_minutes: r.minutes },
                },
            );
        }
        const released = await reservationRepository.releaseStaleHolds(restaurantId);
        const held = await reservationRepository.holdUpcomingTables(restaurantId);
        return { noShows, released, held };
    });

    result.noShows.forEach((r) => emitReservation(r));
    const emitTables = (rows: { id: number; restaurant_id: number }[], status: UsageStatusEnum) => {
        for (const [rid, tableIds] of groupByRestaurant(rows)) {
            emitToRestaurant(rid, "table:status_changed", { restaurant_id: rid, table_ids: tableIds, status });
        }
    };
    emitTables(result.released.filter((r) => r.freed), UsageStatusEnum.AVAILABLE);
    emitTables(result.held, UsageStatusEnum.RESERVED);
    return { no_show: result.noShows.length, released: result.released.length, held: result.held.length };
};

/** Gọi sau khi sửa đặt bàn (đã commit): lỗi chỉ ghi log, không làm hỏng thao tác chính */
const syncAfterWrite = async (restaurantId: number) => {
    try {
        await syncReservationHolds(restaurantId);
    } catch (error) {
        logger.error("Sync reservation holds failed", { error: (error as Error).message });
    }
};

/** Phát sự kiện realtime sau khi commit */
const emitReservation = (reservation: Pick<IReservation, "id" | "restaurant_id">) =>
    emitToRestaurant(reservation.restaurant_id, "reservation:changed", {
        restaurant_id: reservation.restaurant_id,
        reservation_id: reservation.id,
    });

export const createReservation = async (
    body: ICreateReservationBody,
    scope: Scope,
    actorId: number | undefined,
): Promise<IReservation | number> => {
    try {
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            if (isStartInPast(body.start_time)) return rollback(RESERVATION_ERROR.START_IN_PAST);

            const tableIds = [...new Set(body.table_ids)];
            await checkTables({
                restaurantId,
                tableIds,
                guestCount: body.guest_count,
                start: body.start_time,
                end: body.end_time,
            });
            const contact = await resolveContact(body.guest_user_id, body.contact_name, body.contact_phone);

            const created = await reservationRepository.createReservation({
                restaurant_id: restaurantId,
                guest_user_id: body.guest_user_id ?? null,
                ...contact,
                guest_count: body.guest_count,
                start_time: body.start_time,
                end_time: body.end_time,
                status: body.status ?? S.PENDING,
                note: body.note ?? null,
                created_by: actorId ?? null,
            });
            await reservationRepository.addReservationTables(created.id, tableIds);
            return (await reservationRepository.getReservationById(created.id))!;
        });
        if (typeof result !== "number") {
            emitReservation(result);
            await syncAfterWrite(result.restaurant_id);
        }
        return result;
    } catch (error) {
        return toReservationError(error);
    }
};

export const updateReservation = async (
    id: number,
    body: IUpdateReservationBody,
    scope: Scope,
): Promise<IReservation | number> => {
    try {
        const result = await withTransaction(async () => {
            const current = await loadReservation(id, scope, true);
            if (!EDITABLE_STATUSES.includes(current.status)) return rollback(RESERVATION_ERROR.NOT_EDITABLE);

            const start = body.start_time ?? new Date(current.start_time);
            const end = body.end_time ?? new Date(current.end_time);
            // Schema chỉ kiểm tra được khi gửi đủ hai đầu; sửa một đầu thì kiểm tra lại ở đây
            const duration = end.getTime() - start.getTime();
            if (duration <= 0 || duration > MAX_RESERVATION_HOURS * 60 * 60 * 1000) {
                return rollback(RESERVATION_ERROR.INVALID_TIME);
            }

            const timeChanged =
                start.getTime() !== new Date(current.start_time).getTime() ||
                end.getTime() !== new Date(current.end_time).getTime();
            if (body.start_time && timeChanged && isStartInPast(start)) {
                return rollback(RESERVATION_ERROR.START_IN_PAST);
            }

            const tableIds = body.table_ids ? [...new Set(body.table_ids)] : (current.tables || []).map((t) => t.id);
            const guestCount = body.guest_count ?? current.guest_count;
            const tablesChanged = !!body.table_ids;

            if (timeChanged || tablesChanged || body.guest_count !== undefined) {
                await checkTables({
                    restaurantId: current.restaurant_id,
                    tableIds,
                    guestCount,
                    start,
                    end,
                    excludeReservationId: id,
                });
            }

            const row: IReservationRow = {
                guest_count: body.guest_count,
                start_time: body.start_time,
                end_time: body.end_time,
                note: body.note,
            };

            const contactTouched =
                body.guest_user_id !== undefined || body.contact_name !== undefined || body.contact_phone !== undefined;
            if (contactTouched) {
                const guestUserId = body.guest_user_id !== undefined ? body.guest_user_id : current.guest_user_id;
                const contact = await resolveContact(
                    guestUserId,
                    body.contact_name !== undefined ? body.contact_name : current.contact_name,
                    body.contact_phone !== undefined ? body.contact_phone : current.contact_phone,
                );
                Object.assign(row, contact, { guest_user_id: guestUserId ?? null });
            }

            // Giờ đổi: gỡ bàn trước, cập nhật giờ, rồi gắn lại (trigger điền period mới)
            const rebindTables = timeChanged || tablesChanged;
            if (rebindTables) await reservationRepository.clearReservationTables(id);
            const updated = await reservationRepository.updateReservation(id, row);
            if (!updated) return rollback(RESERVATION_ERROR.NOT_FOUND);
            if (rebindTables) await reservationRepository.addReservationTables(id, tableIds);

            return (await reservationRepository.getReservationById(id))!;
        });
        if (typeof result !== "number") {
            emitReservation(result);
            await syncAfterWrite(result.restaurant_id);
        }
        return result;
    } catch (error) {
        return toReservationError(error);
    }
};

/**
 * Đổi trạng thái theo máy trạng thái `TRANSITIONS`.
 * - `arrived`: bàn chuyển sang `occupied` (chặn nếu bàn đang có khách khác). Giai đoạn 4 sẽ tạo order tại bước này.
 * - `completed`: bàn đang `occupied` chuyển sang `cleaning`.
 * - `cancelled` / `no_show`: gỡ giữ chỗ (trigger đặt is_active = false); `no_show` chỉ sau giờ bắt đầu.
 */
/** Mã lỗi khi mở order cho reservation -> mã lỗi reservation */
const fromOrderError = (code: number): number => {
    switch (code) {
        case ORDER_ERROR.TABLE_BUSY:
            return RESERVATION_ERROR.TABLES_OCCUPIED;
        case ORDER_ERROR.INVALID_TABLES:
            return RESERVATION_ERROR.INVALID_TABLES;
        default:
            return RESERVATION_ERROR.FAILED;
    }
};

export const updateReservationStatus = async (
    id: number,
    body: IUpdateReservationStatusBody,
    scope: Scope,
    actorId?: number,
): Promise<IReservation | number> => {
    try {
        let opened: IOpenedOrder | null = null;
        const result = await withTransaction(async () => {
            const current = await loadReservation(id, scope, true);
            if (!TRANSITIONS[current.status].includes(body.status)) {
                return rollback(RESERVATION_ERROR.INVALID_TRANSITION);
            }

            const now = new Date();
            const row: IReservationRow = { status: body.status };

            switch (body.status) {
                case S.ARRIVED: {
                    // Khách đến -> mở order trên các bàn đã đặt (bàn chuyển sang occupied)
                    const order = await withTransaction(() => orderService.openOrderForReservation(current, actorId));
                    if (typeof order === "number") return rollback(fromOrderError(order));
                    opened = order;
                    row.arrived_at = now;
                    break;
                }
                case S.COMPLETED: {
                    // Thường do order hoàn tất tự chuyển; hoàn tất tay chỉ khi không còn order đang mở
                    const order = await orderRepository.getOrderByReservation(id);
                    if (order && OPEN_ORDER_STATUSES.includes(order.status)) return rollback(RESERVATION_ERROR.ORDER_OPEN);
                    if (!order) {
                        await reservationRepository.setTablesStatus(id, UsageStatusEnum.CLEANING, [UsageStatusEnum.OCCUPIED]);
                    }
                    row.completed_at = now;
                    break;
                }
                case S.NO_SHOW:
                    if (now.getTime() < new Date(current.start_time).getTime()) {
                        return rollback(RESERVATION_ERROR.NO_SHOW_TOO_EARLY);
                    }
                    row.cancelled_at = now;
                    row.cancel_reason = body.cancel_reason ?? null;
                    break;
                case S.CANCELLED:
                    row.cancelled_at = now;
                    row.cancel_reason = body.cancel_reason ?? null;
                    break;
            }

            const updated = await reservationRepository.updateReservation(id, row);
            if (!updated) return rollback(RESERVATION_ERROR.NOT_FOUND);
            return (await reservationRepository.getReservationById(id))!;
        });
        if (typeof result !== "number") {
            emitReservation(result);
            if (opened) orderService.emitOrderOpened(opened);
            await syncAfterWrite(result.restaurant_id);
            // Giai đoạn 13: đơn online được xác nhận / hủy thì báo khách qua email
            if (body.status === S.CONFIRMED || body.status === S.CANCELLED) void notifyOnlineBooking(result.id);
        }
        return result;
    } catch (error) {
        return toReservationError(error);
    }
};

/** Xóa mềm; không xóa khi khách đang ngồi (hãy chuyển sang `completed` trước). */
export const deleteReservation = async (id: number, scope: Scope): Promise<{ id: number } | number> => {
    try {
        let restaurantId = 0;
        const result = await withTransaction(async () => {
            const current = await loadReservation(id, scope, true);
            if (current.status === S.ARRIVED) return rollback(RESERVATION_ERROR.CANNOT_DELETE);
            restaurantId = current.restaurant_id;
            return (await reservationRepository.deleteReservation(id)) ?? rollback(RESERVATION_ERROR.NOT_FOUND);
        });
        if (typeof result !== "number") {
            emitReservation({ id, restaurant_id: restaurantId });
            await syncAfterWrite(restaurantId);
        }
        return result;
    } catch (error) {
        return RESERVATION_ERROR.FAILED;
    }
};
