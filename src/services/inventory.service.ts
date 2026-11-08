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
    IInventoryReceipt,
    ISelectQuery,
    IStock,
} from "~/interfaces";
import { inventoryRepository, recipeRepository, restaurantRepository } from "~/repositories";
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

/**
 * Lập phiếu nhập / xuất / kiểm kê. Tồn kho chỉ thay đổi qua đây, kèm một dòng sổ biến động cho mỗi
 * nguyên liệu, tất cả trong một transaction (khóa các dòng tồn kho).
 * - Nhập: cộng số lượng, cập nhật giá vốn bình quân gia quyền.
 * - Xuất: trừ số lượng (không được âm), cần lý do.
 * - Kiểm kê: nhập số thực tế, ghi chênh lệch (bỏ qua dòng không lệch), cần lý do.
 * Xuất và kiểm kê được ghi audit log (đặc tả 6.1).
 */
export const createReceipt = async (
    body: ICreateReceiptBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IInventoryReceipt | number> => {
    try {
        const result = await withTransaction(async () => {
            const restaurantId = await resolveRestaurant(scope, body.restaurant_id);
            const ids = body.lines.map((l) => l.ingredient_id);
            const ingredients = new Map((await inventoryRepository.getIngredientsByIds(ids)).map((i) => [i.id, i]));
            const invalid = ids.some(
                (id) => !ingredients.has(id) || (body.type === R.IMPORT && ingredients.get(id)!.status !== IngredientStatusEnum.ACTIVE),
            );
            if (invalid) return rollback(INVENTORY_ERROR.INVALID_INGREDIENTS);

            const rows = await inventoryRepository.lockInventoryRows(restaurantId, ids);
            const changes: {
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
                if (body.type === R.IMPORT) {
                    const price = round2(line.unit_price ?? 0);
                    const after = round3(before + qty);
                    // Tồn đang âm (đã trừ khi thiếu kho): phần âm không có giá trị, giá bình quân tính trên phần tồn dương
                    const base = Math.max(before, 0);
                    const newAvg = base + qty > 0 ? round2((base * avg + qty * price) / (base + qty)) : price;
                    changes.push({ ingredient_id: line.ingredient_id, change: qty, after, unit_price: price, avg: newAvg, note: line.note ?? null });
                } else if (body.type === R.EXPORT) {
                    // Phiếu xuất tay vẫn không được vượt tồn (chỉ tự trừ khi phục vụ món mới được âm)
                    if (qty > before) return rollback(INVENTORY_ERROR.INSUFFICIENT_STOCK);
                    changes.push({ ingredient_id: line.ingredient_id, change: -qty, after: round3(before - qty), unit_price: avg, avg, note: line.note ?? null });
                } else {
                    const change = round3(qty - before);
                    if (change !== 0) {
                        changes.push({ ingredient_id: line.ingredient_id, change, after: qty, unit_price: avg, avg, note: line.note ?? null });
                    }
                }
            }
            if (changes.length === 0) return rollback(INVENTORY_ERROR.NO_CHANGES);

            // Giá trị phiếu: nhập / xuất = Σ |số lượng| × đơn giá; kiểm kê = Σ chênh lệch × giá vốn (có thể âm)
            const totalValue = round2(
                changes.reduce((s, c) => s + (body.type === R.ADJUST ? c.change : Math.abs(c.change)) * c.unit_price, 0),
            );
            const code = await inventoryRepository.nextReceiptCode(body.type, restaurantId);
            const receipt = await inventoryRepository.createReceipt({
                code,
                restaurant_id: restaurantId,
                type: body.type,
                supplier: body.type === R.IMPORT ? (body.supplier ?? null) : null,
                reason: body.reason ?? null,
                note: body.note ?? null,
                total_value: totalValue,
                created_by: audit.userId ?? null,
            });

            for (const c of changes) {
                await inventoryRepository.updateInventoryRow(restaurantId, c.ingredient_id, c.after, c.avg);
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
                        lines: changes.map((c) => ({ ingredient_id: c.ingredient_id, change: c.change, quantity: c.after })),
                    },
                });
            }

            // Nguyên liệu xuống dưới ngưỡng sau phiếu này (để cảnh báo realtime)
            const low = changes
                .filter((c) => {
                    const min = Number(rows.get(c.ingredient_id)!.min_quantity);
                    return min > 0 && c.after <= min;
                })
                .map((c) => c.ingredient_id);
            return { id: receipt.id, restaurantId, ids: changes.map((c) => c.ingredient_id), low };
        });
        if (typeof result === "number") return result;
        emitToRestaurant(result.restaurantId, "inventory:changed", {
            restaurant_id: result.restaurantId,
            ingredient_ids: result.ids,
            low_ingredient_ids: result.low,
        });
        return (await getReceiptDetail(result.id))!;
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
