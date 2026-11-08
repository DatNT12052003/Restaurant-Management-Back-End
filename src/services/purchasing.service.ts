import { PG_ERROR } from "~/common/constant";
import {
    IngredientStatusEnum,
    InventoryReceiptTypeEnum,
    PurchaseOrderStatusEnum,
    SupplierBillStatusEnum,
    SupplierStatusEnum,
} from "~/common/enum";
import { PURCHASE_ERROR, SUPPLIER_ERROR } from "~/common/error-code/purchasing";
import { rollback, withTransaction } from "~/config/db";
import {
    IAuditContext,
    IGetPurchaseOrders,
    IPurchaseOrder,
    IPurchaseOrderBody,
    IPurchaseSuggestion,
    IReceivePurchaseBody,
    ISelectQuery,
    ISupplier,
    ISupplierBody,
    ISupplierPrice,
    ISupplierPricesBody,
} from "~/interfaces";
import { inventoryRepository, purchasingRepository, restaurantRepository } from "~/repositories";
import { getPgErrorCode } from "~/utils/common";
import { writeAudit } from "~/utils/audit";
import { buildPagination } from "~/utils/pagination";
import { applyReceipt, emitInventoryChanged } from "./inventory.service";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const PO = PurchaseOrderStatusEnum;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Hôm nay theo giờ Việt Nam + `days` ngày, dạng YYYY-MM-DD */
const vnDatePlus = (days: number) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Nhà cung cấp
// ---------------------------------------------------------------------------

const toSupplierError = (error: unknown) =>
    getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION ? SUPPLIER_ERROR.DUPLICATE_NAME : SUPPLIER_ERROR.FAILED;

export const getSuppliers = async (query: { search?: string; status?: string }, scope: Scope): Promise<ISupplier[] | number> => {
    try {
        return await purchasingRepository.getSuppliers({ ...query, restaurantId: scope ?? null });
    } catch (error) {
        return SUPPLIER_ERROR.FAILED;
    }
};

export const getSupplier = async (id: number): Promise<(ISupplier & { prices: ISupplierPrice[] }) | number> => {
    try {
        const supplier = await purchasingRepository.getSupplierById(id);
        if (!supplier) return SUPPLIER_ERROR.NOT_FOUND;
        return { ...supplier, prices: await purchasingRepository.getSupplierPrices(id) };
    } catch (error) {
        return SUPPLIER_ERROR.FAILED;
    }
};

export const createSupplier = async (body: ISupplierBody): Promise<ISupplier | number> => {
    try {
        return await purchasingRepository.createSupplier(body);
    } catch (error) {
        return toSupplierError(error);
    }
};

export const updateSupplier = async (id: number, body: ISupplierBody): Promise<ISupplier | number> => {
    try {
        return (await purchasingRepository.updateSupplier(id, body)) ?? SUPPLIER_ERROR.NOT_FOUND;
    } catch (error) {
        return toSupplierError(error);
    }
};

/** Xóa mềm; không xóa khi còn đơn chưa xong hoặc công nợ chưa trả (chuyển sang ngừng giao dịch thay thế) */
export const deleteSupplier = async (id: number): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            if (!(await purchasingRepository.getSupplierById(id, true))) return rollback(SUPPLIER_ERROR.NOT_FOUND);
            const usage = await purchasingRepository.countSupplierOpenUsage(id);
            if (usage.open_orders > 0 || usage.unpaid_bills > 0) return rollback(SUPPLIER_ERROR.IN_USE);
            return (await purchasingRepository.deleteSupplier(id)) ?? rollback(SUPPLIER_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return SUPPLIER_ERROR.FAILED;
    }
};

/** Thay toàn bộ bảng giá của nhà cung cấp; mỗi nguyên liệu chỉ một nhà cung cấp được đánh dấu ưu tiên là tùy người dùng */
export const updateSupplierPrices = async (id: number, body: ISupplierPricesBody): Promise<ISupplierPrice[] | number> => {
    try {
        return await withTransaction(async () => {
            if (!(await purchasingRepository.getSupplierById(id, true))) return rollback(SUPPLIER_ERROR.NOT_FOUND);
            const ids = body.items.map((i) => i.ingredient_id);
            if ((await inventoryRepository.getIngredientsByIds(ids)).length !== ids.length) {
                return rollback(SUPPLIER_ERROR.INVALID_INGREDIENTS);
            }
            await purchasingRepository.replaceSupplierPrices(
                id,
                body.items.map((i) => ({ ...i, unit_price: round2(i.unit_price) })),
            );
            return purchasingRepository.getSupplierPrices(id);
        });
    } catch (error) {
        return SUPPLIER_ERROR.FAILED;
    }
};

export const getIngredientPrices = async (ingredientId: number): Promise<ISupplierPrice[] | number> => {
    try {
        return await purchasingRepository.getIngredientPrices(ingredientId);
    } catch (error) {
        return SUPPLIER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Đơn đặt hàng
// ---------------------------------------------------------------------------

const resolveRestaurant = async (scope: Scope, requested?: number): Promise<number> => {
    const restaurantId = scope ?? requested;
    if (!restaurantId) return rollback(PURCHASE_ERROR.RESTAURANT_REQUIRED);
    if (!(await restaurantRepository.getRestaurantById(restaurantId))) return rollback(PURCHASE_ERROR.RESTAURANT_NOT_FOUND);
    return restaurantId;
};

const activeSupplier = async (id: number) => {
    const supplier = await purchasingRepository.getSupplierById(id);
    if (!supplier || supplier.status !== SupplierStatusEnum.ACTIVE) return rollback(PURCHASE_ERROR.SUPPLIER_INVALID);
    return supplier;
};

/** Khóa đơn; ngoài phạm vi coi như không tồn tại */
const loadOrder = async (id: number, scope: Scope): Promise<IPurchaseOrder> => {
    const order = await purchasingRepository.getPurchaseOrderById(id, true);
    if (!order || !inScope(order.restaurant_id, scope)) return rollback(PURCHASE_ERROR.NOT_FOUND);
    return order;
};

/** Dòng đơn: nguyên liệu đang dùng; đơn giá bỏ trống thì lấy theo bảng giá của nhà cung cấp (không có thì 0) */
const resolveLines = async (supplierId: number, lines: NonNullable<IPurchaseOrderBody["lines"]>) => {
    const ids = lines.map((l) => l.ingredient_id);
    const found = await inventoryRepository.getIngredientsByIds(ids);
    if (found.length !== ids.length || found.some((g) => g.status !== IngredientStatusEnum.ACTIVE)) {
        return rollback(PURCHASE_ERROR.INVALID_INGREDIENTS);
    }
    const prices = new Map((await purchasingRepository.getSupplierPrices(supplierId)).map((p) => [p.ingredient_id, Number(p.unit_price)]));
    return lines.map((l) => ({
        ingredient_id: l.ingredient_id,
        quantity: round3(l.quantity),
        unit_price: round2(l.unit_price ?? prices.get(l.ingredient_id) ?? 0),
    }));
};

export const detail = async (id: number): Promise<IPurchaseOrder | undefined> => {
    const order = await purchasingRepository.getPurchaseOrderById(id);
    if (!order) return undefined;
    const [lines, receipts] = await Promise.all([
        purchasingRepository.getPurchaseOrderLines(id),
        purchasingRepository.getPurchaseOrderReceipts(id),
    ]);
    return { ...order, lines, receipts };
};

export const getPurchaseOrders = async (params: ISelectQuery): Promise<IGetPurchaseOrders | number> => {
    try {
        const result = await purchasingRepository.getPurchaseOrders(params);
        return { purchase_orders: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

export const getPurchaseOrder = async (id: number, scope: Scope): Promise<IPurchaseOrder | number> => {
    try {
        const order = await detail(id);
        if (!order || !inScope(order.restaurant_id, scope)) return PURCHASE_ERROR.NOT_FOUND;
        return order;
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

/** Lập đơn nháp. `send: true` gửi ngay (bỏ qua bước nháp). */
export const createPurchaseOrder = async (
    body: IPurchaseOrderBody & { send?: boolean },
    scope: Scope,
    actorId: number | undefined,
): Promise<IPurchaseOrder | number> => {
    try {
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            await activeSupplier(body.supplier_id!);
            const lines = await resolveLines(body.supplier_id!, body.lines!);
            const code = await purchasingRepository.nextPurchaseOrderCode(restaurantId);
            const created = await purchasingRepository.createPurchaseOrder({
                code,
                restaurant_id: restaurantId,
                supplier_id: body.supplier_id,
                status: body.send ? PO.SENT : PO.DRAFT,
                sent_at: body.send ? new Date() : null,
                expected_date: body.expected_date ?? null,
                note: body.note ?? null,
                created_by: actorId ?? null,
            });
            await purchasingRepository.replacePurchaseOrderLines(created.id, lines);
            return { id: created.id };
        });
        if (typeof result === "number") return result;
        return (await detail(result.id))!;
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

/** Sửa đơn: chỉ khi còn nháp (nhà cung cấp, ngày dự kiến, ghi chú, thay toàn bộ dòng) */
export const updatePurchaseOrder = async (id: number, body: IPurchaseOrderBody, scope: Scope): Promise<IPurchaseOrder | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            if (order.status !== PO.DRAFT) return rollback(PURCHASE_ERROR.INVALID_STATUS);
            const supplierId = body.supplier_id ?? order.supplier_id;
            if (body.supplier_id) await activeSupplier(body.supplier_id);
            await purchasingRepository.updatePurchaseOrder(id, {
                supplier_id: supplierId,
                expected_date: body.expected_date,
                note: body.note,
            });
            if (body.lines) await purchasingRepository.replacePurchaseOrderLines(id, await resolveLines(supplierId, body.lines));
            return { id };
        });
        if (typeof result === "number") return result;
        return (await detail(id))!;
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

/** Đổi trạng thái đơn: gửi (nháp -> đã gửi), hủy (nháp / đã gửi, chưa nhận gì), đóng (nhận một phần, không chờ thêm) */
export const changePurchaseOrderStatus = async (
    id: number,
    action: "send" | "cancel" | "close",
    scope: Scope,
    audit: IAuditContext,
    reason?: string | null,
): Promise<IPurchaseOrder | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            const now = new Date();
            if (action === "send") {
                if (order.status !== PO.DRAFT) return rollback(PURCHASE_ERROR.INVALID_STATUS);
                await purchasingRepository.updatePurchaseOrder(id, { status: PO.SENT, sent_at: now });
            } else if (action === "cancel") {
                if (order.status !== PO.DRAFT && order.status !== PO.SENT) {
                    return rollback(order.status === PO.PARTIAL ? PURCHASE_ERROR.HAS_RECEIPTS : PURCHASE_ERROR.INVALID_STATUS);
                }
                await purchasingRepository.updatePurchaseOrder(id, { status: PO.CANCELLED, closed_at: now, cancel_reason: reason ?? null });
            } else {
                if (order.status !== PO.PARTIAL) return rollback(PURCHASE_ERROR.INVALID_STATUS);
                await purchasingRepository.updatePurchaseOrder(id, { status: PO.CLOSED, closed_at: now, cancel_reason: reason ?? null });
            }
            if (action !== "send") {
                await writeAudit(audit, {
                    action: `purchase_order.${action}`,
                    entity_type: "purchase_order",
                    entity_id: id,
                    restaurant_id: order.restaurant_id,
                    before: { code: order.code, status: order.status },
                    after: { status: action === "cancel" ? PO.CANCELLED : PO.CLOSED, reason: reason ?? null },
                });
            }
            return { id };
        });
        if (typeof result === "number") return result;
        return (await detail(id))!;
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

/**
 * Nhận hàng theo đơn (đã gửi / nhận một phần): tạo phiếu nhập kho gắn đơn và nhà cung cấp (giá thực nhận có thể khác
 * giá đặt), cộng số đã nhận từng dòng, cập nhật bảng giá của nhà cung cấp, và tạo một khoản phải trả với hạn thanh toán
 * theo điều khoản của nhà cung cấp. Nhận đủ mọi dòng thì đơn chuyển `received`, ngược lại `partial`.
 */
export const receivePurchaseOrder = async (
    id: number,
    body: IReceivePurchaseBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IPurchaseOrder | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(id, scope);
            if (order.status !== PO.SENT && order.status !== PO.PARTIAL) return rollback(PURCHASE_ERROR.INVALID_STATUS);
            const supplier = (await purchasingRepository.getSupplierById(order.supplier_id))!;
            const lines = new Map((await purchasingRepository.getPurchaseOrderLines(id, true)).map((l) => [l.id, l]));
            const received = body.lines.filter((l) => l.quantity > 0);
            if (received.length === 0 || received.some((l) => !lines.has(l.line_id))) return rollback(PURCHASE_ERROR.INVALID_LINES);
            if (received.some((l) => lines.get(l.line_id)!.track_expiry && !l.expiry_date)) return rollback(PURCHASE_ERROR.EXPIRY_REQUIRED);

            const receipt = await applyReceipt(
                order.restaurant_id,
                {
                    type: InventoryReceiptTypeEnum.IMPORT,
                    supplier_id: order.supplier_id,
                    note: body.note ?? `${order.code}`,
                    lines: received.map((l) => {
                        const line = lines.get(l.line_id)!;
                        return {
                            ingredient_id: line.ingredient_id,
                            quantity: l.quantity,
                            unit_price: l.unit_price ?? Number(line.unit_price),
                            expiry_date: l.expiry_date ?? null,
                            lot_code: l.lot_code ?? null,
                        };
                    }),
                },
                audit,
                { purchase_order_id: id },
            );

            for (const l of received) {
                const line = lines.get(l.line_id)!;
                await purchasingRepository.addReceivedQuantity(l.line_id, round3(l.quantity));
                line.received_quantity = String(Number(line.received_quantity) + l.quantity);
                await purchasingRepository.upsertSupplierPrice(order.supplier_id, line.ingredient_id, round2(l.unit_price ?? Number(line.unit_price)));
            }
            const complete = [...lines.values()].every((l) => Number(l.received_quantity) >= Number(l.quantity) - 1e-9);
            await purchasingRepository.updatePurchaseOrder(id, {
                status: complete ? PO.RECEIVED : PO.PARTIAL,
                ...(complete ? { closed_at: new Date() } : {}),
            });

            await purchasingRepository.createBill({
                supplier_id: order.supplier_id,
                restaurant_id: order.restaurant_id,
                purchase_order_id: id,
                receipt_id: receipt.id,
                amount: receipt.totalValue,
                due_date: vnDatePlus(supplier.payment_terms_days),
                status: receipt.totalValue > 0 ? SupplierBillStatusEnum.UNPAID : SupplierBillStatusEnum.PAID,
            });
            return receipt;
        });
        if (typeof result === "number") return result;
        emitInventoryChanged(result.restaurantId, result.ids, result.low);
        return (await detail(id))!;
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};

/**
 * Gợi ý số lượng đặt: đủ dùng `cover_days` ngày theo mức tiêu hao trung bình `lookback_days` ngày gần nhất,
 * cộng ngưỡng tồn tối thiểu, trừ tồn hiện có và hàng đang về. `supplier_id`: chỉ nguyên liệu trong bảng giá.
 */
export const getSuggestions = async (
    scope: Scope,
    query: { restaurant_id?: number; supplier_id?: number; cover_days?: number; lookback_days?: number },
): Promise<{ restaurant_id: number; cover_days: number; lookback_days: number; items: IPurchaseSuggestion[] } | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, query.restaurant_id);
            const cover = query.cover_days ?? 7;
            const lookback = query.lookback_days ?? 14;
            const rows = await purchasingRepository.getSuggestionData(restaurantId, query.supplier_id ?? null, lookback);
            const items = rows.map((r) => {
                const stock = Number(r.stock);
                const min = Number(r.min_quantity);
                const usage = Number(r.avg_daily_usage);
                const incoming = Number(r.incoming);
                // Làm tròn lên 3 chữ số thập phân
                const need = Math.ceil(Math.max(0, min + usage * cover - stock - incoming) * 1000) / 1000;
                return {
                    ingredient_id: r.ingredient_id,
                    name: r.name,
                    unit: r.unit,
                    stock,
                    min_quantity: min,
                    avg_daily_usage: round3(usage),
                    incoming,
                    suggested_quantity: need,
                    unit_price: r.unit_price === null ? null : Number(r.unit_price),
                };
            });
            return {
                restaurant_id: restaurantId,
                cover_days: cover,
                lookback_days: lookback,
                items: items.sort((a, b) => b.suggested_quantity - a.suggested_quantity || a.name.localeCompare(b.name)),
            };
        });
    } catch (error) {
        return PURCHASE_ERROR.FAILED;
    }
};
