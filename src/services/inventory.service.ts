import { PG_ERROR } from "~/common/constant";
import { IngredientStatusEnum, InventoryReceiptTypeEnum } from "~/common/enum";
import { INGREDIENT_ERROR, INVENTORY_ERROR } from "~/common/error-code/inventory";
import { rollback, withTransaction } from "~/config/db";
import {
    IAuditContext,
    ICreateReceiptBody,
    IGetInventoryTransactions,
    IGetReceipts,
    IIngredient,
    IIngredientBody,
    IInventoryLot,
    IInventoryReceipt,
    ISelectQuery,
    IStock,
} from "~/interfaces";
import { inventoryRepository, lotRepository, purchasingRepository, recipeRepository, restaurantRepository } from "~/repositories";
import { emitToRestaurant } from "~/sockets";
import { writeAudit } from "~/utils/audit";
import { getPgErrorCode } from "~/utils/common";
import { buildPagination } from "~/utils/pagination";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const R = InventoryReceiptTypeEnum;

/** Làm tròn về 3 chữ số thập phân (số lượng) / 2 chữ số (tiền), tránh sai số dấu phẩy động */
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

const resolveRestaurant = async (scope: Scope, requested?: number): Promise<number> => {
    const restaurantId = scope ?? requested;
    if (!restaurantId) return rollback(INVENTORY_ERROR.RESTAURANT_REQUIRED);
    if (!(await restaurantRepository.getRestaurantById(restaurantId))) return rollback(INVENTORY_ERROR.RESTAURANT_NOT_FOUND);
    return restaurantId;
};

// ---------------------------------------------------------------------------
// Nguyên liệu (danh mục chung)
// ---------------------------------------------------------------------------

const toIngredientError = (error: unknown): number =>
    getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION ? INGREDIENT_ERROR.DUPLICATE_NAME : INGREDIENT_ERROR.FAILED;

export const getIngredients = async (search?: string, status?: string): Promise<IIngredient[] | number> => {
    try {
        return await inventoryRepository.getIngredients(search, status);
    } catch (error) {
        return INGREDIENT_ERROR.FAILED;
    }
};

export const createIngredient = async (body: IIngredientBody): Promise<IIngredient | number> => {
    try {
        return await inventoryRepository.createIngredient(body);
    } catch (error) {
        return toIngredientError(error);
    }
};

/** Đơn vị tính chỉ đổi được khi nguyên liệu chưa từng có biến động kho (tránh sai lệch số liệu cũ) */
export const updateIngredient = async (id: number, body: IIngredientBody): Promise<IIngredient | number> => {
    try {
        return await withTransaction(async () => {
            const current = await inventoryRepository.getIngredientById(id, true);
            if (!current) return rollback(INGREDIENT_ERROR.NOT_FOUND);
            if (body.unit !== undefined && body.unit !== current.unit) {
                if ((await inventoryRepository.getIngredientUsage(id)).has_transactions) {
                    return rollback(INGREDIENT_ERROR.UNIT_LOCKED);
                }
            }
            return (await inventoryRepository.updateIngredient(id, body)) ?? rollback(INGREDIENT_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return toIngredientError(error);
    }
};

/** Xóa mềm; không xóa khi còn tồn kho ở nhà hàng nào (hãy xuất / kiểm kê về 0 hoặc chuyển sang ngừng dùng) */
export const deleteIngredient = async (id: number): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            if (!(await inventoryRepository.getIngredientById(id, true))) return rollback(INGREDIENT_ERROR.NOT_FOUND);
            if ((await inventoryRepository.getIngredientUsage(id)).stock > 0) return rollback(INGREDIENT_ERROR.IN_STOCK);
            if ((await recipeRepository.countDishesUsingIngredient(id)) > 0) return rollback(INGREDIENT_ERROR.IN_RECIPE);
            return (await inventoryRepository.deleteIngredient(id)) ?? rollback(INGREDIENT_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return INGREDIENT_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Tồn kho
// ---------------------------------------------------------------------------

export const getStock = async (
    scope: Scope,
    query: { restaurant_id?: number; low_only?: boolean; include_inactive?: boolean },
): Promise<IStock | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, query.restaurant_id);
            const items = await inventoryRepository.getStock(restaurantId, {
                lowOnly: query.low_only,
                includeInactive: query.include_inactive,
            });
            return {
                restaurant_id: restaurantId,
                items,
                summary: {
                    total_value: round2(items.reduce((s, i) => s + Number(i.stock_value), 0)).toFixed(2),
                    low_count: items.filter((i) => i.is_low).length,
                    item_count: items.length,
                },
            };
        });
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

export const setMinQuantity = async (
    scope: Scope,
    body: { restaurant_id?: number; ingredient_id: number; min_quantity: number },
): Promise<{ ingredient_id: number; min_quantity: number } | number> => {
    try {
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            if (!(await inventoryRepository.getIngredientById(body.ingredient_id))) {
                return rollback(INVENTORY_ERROR.INVALID_INGREDIENTS);
            }
            await inventoryRepository.setMinQuantity(restaurantId, body.ingredient_id, round3(body.min_quantity));
            // Trả object để không lẫn id nhà hàng với mã lỗi số
            return { restaurantId };
        });
        if (typeof result === "number") return result;
        emitToRestaurant(result.restaurantId, "inventory:changed", {
            restaurant_id: result.restaurantId,
            ingredient_ids: [body.ingredient_id],
            low_ingredient_ids: [],
        });
        return { ingredient_id: body.ingredient_id, min_quantity: round3(body.min_quantity) };
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Phiếu kho
// ---------------------------------------------------------------------------

/** Kết quả lập phiếu (trong transaction), dùng để phát sự kiện sau commit */
export interface IAppliedReceipt {
    id: number;
    code: string;
    restaurantId: number;
    totalValue: number;
    ids: number[];
    low: number[];
}

/** Phát `inventory:changed` sau commit */
export const emitInventoryChanged = (restaurantId: number, ids: number[], low: number[]) =>
    emitToRestaurant(restaurantId, "inventory:changed", { restaurant_id: restaurantId, ingredient_ids: ids, low_ingredient_ids: low });

/**
 * Lập phiếu kho (GỌI TRONG transaction, nhà hàng đã kiểm tra): cập nhật tồn kho và sổ biến động của nhiều nguyên liệu,
 * khóa các dòng tồn kho theo thứ tự id.
 * - Nhập: cộng số lượng, cập nhật giá vốn bình quân gia quyền. Nguyên liệu theo dõi hạn dùng phải có hạn dùng; mỗi dòng tạo một lô.
 * - Xuất / hủy hàng: trừ số lượng (không vượt tồn), cần lý do; trừ lô theo FEFO (hủy hàng có thể chỉ định đúng một lô).
 * - Kiểm kê: nhập số thực tế, ghi chênh lệch (bỏ qua dòng không lệch); chênh lệch âm trừ lô theo FEFO.
 * Xuất, hủy và kiểm kê được ghi audit log (đặc tả 6.1).
 * `links`: phiếu nhập sinh ra từ đơn đặt hàng (giai đoạn 11).
 */
export const applyReceipt = async (
    restaurantId: number,
    body: ICreateReceiptBody,
    audit: IAuditContext,
    links: { purchase_order_id?: number | null } = {},
): Promise<IAppliedReceipt> => {
    const ids = body.lines.map((l) => l.ingredient_id);
    const ingredients = new Map((await inventoryRepository.getIngredientsByIds(ids)).map((i) => [i.id, i]));
    const invalid = ids.some(
        (id) => !ingredients.has(id) || (body.type === R.IMPORT && ingredients.get(id)!.status !== IngredientStatusEnum.ACTIVE),
    );
    if (invalid) return rollback(INVENTORY_ERROR.INVALID_INGREDIENTS);

    // Nhà cung cấp trong danh mục (phiếu nhập): ghi cả tên vào ô chữ để báo cáo cũ vẫn đọc được
    let supplierName = body.type === R.IMPORT ? (body.supplier ?? null) : null;
    const supplierId = body.type === R.IMPORT ? (body.supplier_id ?? null) : null;
    if (supplierId) {
        const supplier = await purchasingRepository.getSupplierById(supplierId);
        if (!supplier) return rollback(INVENTORY_ERROR.SUPPLIER_INVALID);
        supplierName = supplier.name;
    }
    const tracked = (id: number) => ingredients.get(id)!.track_expiry;
    if (body.type === R.IMPORT && body.lines.some((l) => tracked(l.ingredient_id) && !l.expiry_date)) {
        return rollback(INVENTORY_ERROR.EXPIRY_REQUIRED);
    }

    const rows = await inventoryRepository.lockInventoryRows(restaurantId, ids);
    const changes: {
        line: (typeof body.lines)[number];
        ingredient_id: number;
        change: number;
        after: number;
        unit_price: number;
        avg: number;
        note: string | null;
    }[] = [];

    for (const line of body.lines) {
        const row = rows.get(line.ingredient_id)!;
        const before = Number(row.quantity);
        const avg = Number(row.avg_unit_cost);
        const qty = round3(line.quantity);
        const base = { line, ingredient_id: line.ingredient_id, note: line.note ?? null };
        if (body.type === R.IMPORT) {
            const price = round2(line.unit_price ?? 0);
            const after = round3(before + qty);
            // Tồn đang âm (đã trừ khi thiếu kho): phần âm không có giá trị, giá bình quân tính trên phần tồn dương
            const positive = Math.max(before, 0);
            const newAvg = positive + qty > 0 ? round2((positive * avg + qty * price) / (positive + qty)) : price;
            changes.push({ ...base, change: qty, after, unit_price: price, avg: newAvg });
        } else if (body.type === R.EXPORT || body.type === R.DISPOSE) {
            // Phiếu xuất / hủy tay không được vượt tồn (chỉ tự trừ khi phục vụ món mới được âm)
            if (qty > before) return rollback(INVENTORY_ERROR.INSUFFICIENT_STOCK);
            if (line.lot_id) {
                const lot = await lotRepository.getLotById(line.lot_id);
                if (!lot || lot.restaurant_id !== restaurantId || lot.ingredient_id !== line.ingredient_id) {
                    return rollback(INVENTORY_ERROR.LOT_NOT_FOUND);
                }
                if (qty > Number(lot.quantity)) return rollback(INVENTORY_ERROR.INSUFFICIENT_STOCK);
            }
            changes.push({ ...base, change: -qty, after: round3(before - qty), unit_price: avg, avg });
        } else {
            const change = round3(qty - before);
            if (change !== 0) changes.push({ ...base, change, after: qty, unit_price: avg, avg });
        }
    }
    if (changes.length === 0) return rollback(INVENTORY_ERROR.NO_CHANGES);

    // Giá trị phiếu: nhập / xuất / hủy = Σ |số lượng| × đơn giá; kiểm kê = Σ chênh lệch × giá vốn (có thể âm)
    const totalValue = round2(changes.reduce((s, c) => s + (body.type === R.ADJUST ? c.change : Math.abs(c.change)) * c.unit_price, 0));
    const code = await inventoryRepository.nextReceiptCode(body.type, restaurantId);
    const receipt = await inventoryRepository.createReceipt({
        code,
        restaurant_id: restaurantId,
        type: body.type,
        supplier: supplierName,
        supplier_id: supplierId,
        purchase_order_id: links.purchase_order_id ?? null,
        reason: body.reason ?? null,
        note: body.note ?? null,
        total_value: totalValue,
        created_by: audit.userId ?? null,
    });

    const lots: Record<number, unknown> = {};
    for (const c of changes) {
        await inventoryRepository.updateInventoryRow(restaurantId, c.ingredient_id, c.after, c.avg);
        if (!tracked(c.ingredient_id)) continue;
        if (c.change > 0 && body.type === R.IMPORT) {
            await lotRepository.createLot({
                restaurant_id: restaurantId,
                ingredient_id: c.ingredient_id,
                lot_code: c.line.lot_code ?? null,
                expiry_date: c.line.expiry_date!,
                quantity: c.change,
                receipt_id: receipt.id,
            });
        } else if (c.change < 0) {
            lots[c.ingredient_id] = await lotRepository.takeFromLots(restaurantId, c.ingredient_id, -c.change, c.line.lot_id);
        }
    }
    await inventoryRepository.insertTransactions(
        changes.map((c) => ({
            restaurant_id: restaurantId,
            ingredient_id: c.ingredient_id,
            receipt_id: receipt.id,
            type: body.type,
            quantity_change: c.change,
            quantity_after: c.after,
            unit_price: c.unit_price,
            reason: c.note ?? body.reason ?? null,
            created_by: audit.userId ?? null,
        })),
    );

    if (body.type !== R.IMPORT) {
        await writeAudit(audit, {
            action: `inventory.${body.type}`,
            entity_type: "inventory_receipt",
            entity_id: receipt.id,
            restaurant_id: restaurantId,
            before: changes.map((c) => ({ ingredient_id: c.ingredient_id, quantity: round3(c.after - c.change) })),
            after: {
                code,
                reason: body.reason,
                lines: changes.map((c) => ({ ingredient_id: c.ingredient_id, change: c.change, quantity: c.after, lots: lots[c.ingredient_id] })),
            },
        });
    }

    // Nguyên liệu xuống dưới ngưỡng (hoặc âm) sau phiếu này (để cảnh báo realtime)
    const low = changes
        .filter((c) => {
            const min = Number(rows.get(c.ingredient_id)!.min_quantity);
            return c.after < 0 || (min > 0 && c.after <= min);
        })
        .map((c) => c.ingredient_id);
    return { id: receipt.id, code, restaurantId, totalValue, ids: changes.map((c) => c.ingredient_id), low };
};

export const createReceipt = async (
    body: ICreateReceiptBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IInventoryReceipt | number> => {
    try {
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            return applyReceipt(restaurantId, body, audit);
        });
        if (typeof result === "number") return result;
        emitInventoryChanged(result.restaurantId, result.ids, result.low);
        return (await getReceiptDetail(result.id))!;
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Lô hàng và hạn dùng (giai đoạn 11)
// ---------------------------------------------------------------------------

/** Số ngày mặc định để cảnh báo lô sắp hết hạn */
export const EXPIRY_WARNING_DAYS = 3;

export const getLots = async (
    scope: Scope,
    query: { restaurant_id?: number; ingredient_id?: number; expiring_days?: number },
): Promise<{ restaurant_id: number; lots: IInventoryLot[]; summary: { expiring: number; expired: number; warning_days: number } } | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, query.restaurant_id);
            const [lots, summary] = await Promise.all([
                lotRepository.getLots(restaurantId, { ingredientId: query.ingredient_id, expiringDays: query.expiring_days }),
                lotRepository.countExpiring(restaurantId, EXPIRY_WARNING_DAYS),
            ]);
            return { restaurant_id: restaurantId, lots, summary: { ...summary, warning_days: EXPIRY_WARNING_DAYS } };
        });
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

const getReceiptDetail = async (id: number): Promise<IInventoryReceipt | undefined> => {
    const receipt = await inventoryRepository.getReceiptById(id);
    if (!receipt) return undefined;
    return { ...receipt, lines: await inventoryRepository.getReceiptLines(id) };
};

export const getReceiptById = async (id: number, scope: Scope): Promise<IInventoryReceipt | number> => {
    try {
        const receipt = await getReceiptDetail(id);
        if (!receipt || !inScope(receipt.restaurant_id, scope)) return INVENTORY_ERROR.RECEIPT_NOT_FOUND;
        return receipt;
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

export const getReceipts = async (params: ISelectQuery): Promise<IGetReceipts | number> => {
    try {
        const result = await inventoryRepository.getReceipts(params);
        return { receipts: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};

export const getTransactions = async (params: ISelectQuery): Promise<IGetInventoryTransactions | number> => {
    try {
        const result = await inventoryRepository.getTransactions(params);
        return { transactions: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return INVENTORY_ERROR.FAILED;
    }
};
