import { OrderRequestStatusEnum } from "~/common/enum";
import { ORDER_REQUEST_ERROR } from "~/common/error-code/customer";
import { ORDER_ERROR } from "~/common/error-code/order";
import { rollback, withTransaction } from "~/config/db";
import { ICreateOrderRequestBody, IOrderRequest, IPublicTable } from "~/interfaces";
import { customerRepository, orderRepository, reservationRepository } from "~/repositories";
import { emitToRestaurant } from "~/sockets";
import * as orderService from "./order.service";

/**
 * Giai đoạn 13: gọi món bằng mã QR tại bàn (câu hỏi 11 đã chốt).
 * - Khách không cần đăng nhập. Mỗi bàn có `qr_token` cố định (đổi được). Khách gửi yêu cầu gọi món; tối đa
 *   `MAX_PENDING` yêu cầu đang chờ mỗi bàn.
 * - Nhân viên (`order_request.handle`) duyệt: bàn chưa có order thì mở order, rồi thêm một đợt gọi món (gửi bếp như gọi tay).
 *   Từ chối kèm lý do. Thanh toán sau bữa như hiện tại.
 * - Khách đã đăng nhập (tài khoản khách) thì order được gắn vào tài khoản để tích điểm.
 */

const R = OrderRequestStatusEnum;
const MAX_PENDING = 3;
/** Order hoàn tất trong bao nhiêu giờ thì khách vãng lai còn đánh giá được qua QR của bàn */
export const FEEDBACK_HOURS = 24;

type Scope = number | null | undefined;

/** Thêm tên / giá hiện tại của món để hiển thị */
const withLines = async (requests: IOrderRequest[]): Promise<IOrderRequest[]> => {
    if (!requests.length) return requests;
    const out: IOrderRequest[] = [];
    for (const q of requests) {
        const names = await customerRepository.getItemNames(
            q.restaurant_id,
            q.items.dishes.map((d) => d.dish_id),
            q.items.combos.map((c) => c.combo_id),
        );
        out.push({
            ...q,
            lines: [
                ...q.items.dishes.map((d) => ({
                    kind: "dish" as const,
                    id: d.dish_id,
                    name: names.dishes.get(d.dish_id)?.name ?? `#${d.dish_id}`,
                    quantity: d.quantity,
                    note: d.note ?? null,
                    price: names.dishes.get(d.dish_id)?.price ?? null,
                })),
                ...q.items.combos.map((c) => ({
                    kind: "combo" as const,
                    id: c.combo_id,
                    name: names.combos.get(c.combo_id)?.name ?? `#${c.combo_id}`,
                    quantity: c.quantity,
                    note: c.note ?? null,
                    price: names.combos.get(c.combo_id)?.price ?? null,
                })),
            ],
        });
    }
    return out;
};

/** Thông tin trả cho khách: bỏ mã trình duyệt và id nội bộ */
const publicView = ({ client_token, guest_user_id, decided_by, guest_name, ...q }: IOrderRequest) => q;

const emitChanged = (q: { id: number; restaurant_id: number; table_id: number; status: string }, event: "order_request:created" | "order_request:changed" = "order_request:changed") =>
    emitToRestaurant(q.restaurant_id, event, { restaurant_id: q.restaurant_id, request_id: q.id, table_id: q.table_id, status: q.status });

// ---------------------------------------------------------------------------
// Phía khách
// ---------------------------------------------------------------------------

export const getTable = async (token: string): Promise<IPublicTable | number> => {
    try {
        const table = await customerRepository.getTableByToken(token);
        if (!table) return ORDER_REQUEST_ERROR.TABLE_NOT_FOUND;
        const orderId = await orderRepository.getOpenOrderIdByTable(table.id);
        let order: IPublicTable["order"] = null;
        if (orderId) {
            const brief = (await customerRepository.getOrderBrief(orderId))!;
            order = { code: brief.code, total: brief.total, lines: await customerRepository.getOrderLines(orderId) };
        }
        // Bàn đã có khách mới thì không mời đánh giá order trước
        const feedback = orderId ? undefined : await customerRepository.getRecentCompletedOrderAtTable(table.id, FEEDBACK_HOURS);
        return {
            table: { id: table.id, name: table.name, room_name: table.room_name },
            restaurant: { id: table.restaurant_id, name: table.restaurant_name, qr_ordering_enabled: table.qr_ordering_enabled },
            order,
            feedback_order: feedback ?? null,
        };
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

export const createRequest = async (
    token: string,
    body: ICreateOrderRequestBody,
    guestUserId: number | null,
    ip: string | null,
): Promise<ReturnType<typeof publicView> | number> => {
    try {
        const result = await withTransaction(async () => {
            const table = await customerRepository.getTableByToken(token);
            if (!table) return rollback(ORDER_REQUEST_ERROR.TABLE_NOT_FOUND);
            if (!table.qr_ordering_enabled) return rollback(ORDER_REQUEST_ERROR.DISABLED);
            const dishes = body.dishes ?? [];
            const combos = body.combos ?? [];
            if (!dishes.length && !combos.length) return rollback(ORDER_REQUEST_ERROR.EMPTY);
            const dishIds = [...new Set(dishes.map((d) => d.dish_id))];
            const comboIds = [...new Set(combos.map((c) => c.combo_id))];
            const [d, c] = await Promise.all([
                orderRepository.getSellableItems("dish", table.restaurant_id, dishIds),
                orderRepository.getSellableItems("combo", table.restaurant_id, comboIds),
            ]);
            if (d.length !== dishIds.length || c.length !== comboIds.length) return rollback(ORDER_REQUEST_ERROR.ITEM_UNAVAILABLE);
            // Khóa bàn để đếm số yêu cầu đang chờ chính xác
            await reservationRepository.getBookableTables(table.restaurant_id, [table.id]);
            if ((await customerRepository.countPendingRequests(table.id)) >= MAX_PENDING) return rollback(ORDER_REQUEST_ERROR.TOO_MANY_PENDING);
            const { id } = await customerRepository.createOrderRequest({
                restaurant_id: table.restaurant_id,
                table_id: table.id,
                guest_user_id: guestUserId,
                client_token: body.client_token,
                guest_count: body.guest_count ?? null,
                items: { dishes, combos },
                note: body.note ?? null,
                ip,
            });
            return (await customerRepository.getOrderRequestById(id))!;
        });
        if (typeof result === "number") return result;
        emitChanged(result, "order_request:created");
        return publicView((await withLines([result]))[0]);
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

/** Yêu cầu của trình duyệt này ở bàn (theo `client_token`) */
export const getMyRequests = async (token: string, clientToken: string): Promise<ReturnType<typeof publicView>[] | number> => {
    try {
        const table = await customerRepository.getTableByToken(token);
        if (!table) return ORDER_REQUEST_ERROR.TABLE_NOT_FOUND;
        const rows = await customerRepository.getOrderRequests({ tableId: table.id, clientToken, limit: 20 });
        return (await withLines(rows)).map(publicView);
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Phía nhân viên
// ---------------------------------------------------------------------------

export const getRequests = async (scope: Scope, query: { restaurant_id?: number; status?: string }): Promise<IOrderRequest[] | number> => {
    try {
        const restaurantId = scope ?? query.restaurant_id ?? null;
        const rows = await customerRepository.getOrderRequests({ restaurantId, status: query.status, limit: query.status === R.PENDING ? 200 : 100 });
        return (await withLines(rows)).map(({ client_token, ...q }) => q);
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

const loadPending = async (id: number, scope: Scope) => {
    const q = await customerRepository.getOrderRequestById(id, true);
    if (!q || (scope !== null && scope !== undefined && q.restaurant_id !== scope)) return rollback(ORDER_REQUEST_ERROR.NOT_FOUND);
    if (q.status !== R.PENDING) return rollback(ORDER_REQUEST_ERROR.INVALID_STATUS);
    return q;
};

const fromOrderError = (code: number) => {
    if (code === ORDER_ERROR.ITEM_UNAVAILABLE) return ORDER_REQUEST_ERROR.ITEM_UNAVAILABLE;
    if (code === ORDER_ERROR.INVALID_TABLES || code === ORDER_ERROR.TABLE_BUSY) return ORDER_REQUEST_ERROR.TABLE_UNAVAILABLE;
    return code;
};

/**
 * Duyệt: bàn chưa có order thì mở order (gắn khách nếu khách đăng nhập), rồi thêm một đợt gọi món gửi bếp.
 * Món đã ngừng bán thì không duyệt được (nhân viên từ chối và báo khách).
 */
export const acceptRequest = async (id: number, scope: Scope, actorId: number): Promise<IOrderRequest | number> => {
    try {
        const result = await withTransaction(async () => {
            const q = await loadPending(id, scope);
            let orderId = await orderRepository.getOpenOrderIdByTable(q.table_id);
            if (!orderId) {
                const opened = await orderService.createOrder(
                    { restaurant_id: q.restaurant_id, table_ids: [q.table_id], guest_count: q.guest_count ?? 1, guest_user_id: q.guest_user_id },
                    q.restaurant_id,
                    actorId,
                );
                if (typeof opened === "number") return rollback(fromOrderError(opened));
                orderId = opened.id;
            } else if (q.guest_user_id) {
                const order = await orderRepository.getOrderRow(orderId);
                if (order && !order.guest_user_id) await orderRepository.updateOrder(orderId, { guest_user_id: q.guest_user_id });
            }
            const round = await orderService.addRound(
                orderId,
                {
                    table_id: q.table_id,
                    note: q.note ? `QR: ${q.note}` : "QR",
                    items: q.items.dishes.map((d) => ({ dish_id: d.dish_id, quantity: d.quantity, note: d.note ?? null })),
                    combos: q.items.combos.map((c) => ({ combo_id: c.combo_id, quantity: c.quantity, note: c.note ?? null })),
                },
                q.restaurant_id,
                actorId,
            );
            if (typeof round === "number") return rollback(fromOrderError(round));
            const roundId = await customerRepository.getLatestRoundId(orderId);
            await customerRepository.updateOrderRequest(id, { status: R.ACCEPTED, order_id: orderId, round_id: roundId ?? null, decided_by: actorId });
            return (await customerRepository.getOrderRequestById(id))!;
        });
        if (typeof result === "number") return result;
        emitChanged(result);
        return (await withLines([result]))[0];
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

export const rejectRequest = async (id: number, reason: string | null | undefined, scope: Scope, actorId: number): Promise<IOrderRequest | number> => {
    try {
        const result = await withTransaction(async () => {
            await loadPending(id, scope);
            await customerRepository.updateOrderRequest(id, { status: R.REJECTED, reject_reason: reason ?? null, decided_by: actorId });
            return (await customerRepository.getOrderRequestById(id))!;
        });
        if (typeof result === "number") return result;
        emitChanged(result);
        return (await withLines([result]))[0];
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};

/** Đổi mã QR của bàn (mã cũ, kể cả bản in, hết dùng được) */
export const rotateTableQr = async (tableId: number, scope: Scope): Promise<{ id: number; qr_token: string } | number> => {
    try {
        const table = await customerRepository.getTableRestaurant(tableId);
        if (!table || (scope !== null && scope !== undefined && table.restaurant_id !== scope)) return ORDER_REQUEST_ERROR.TABLE_NOT_FOUND;
        const token = await customerRepository.rotateTableToken(tableId);
        return token ? { id: tableId, qr_token: token } : ORDER_REQUEST_ERROR.TABLE_NOT_FOUND;
    } catch (error) {
        return ORDER_REQUEST_ERROR.FAILED;
    }
};
