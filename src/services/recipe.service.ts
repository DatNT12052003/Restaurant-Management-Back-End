import { RECIPE_ERROR } from "~/common/error-code/recipe";
import { rollback, withTransaction } from "~/config/db";
import { IAuditContext, IConsumeResult, IDishRecipe, IMenuCosts, IRecipeBody, IServedLine } from "~/interfaces";
import { inventoryRepository, lotRepository, recipeRepository, restaurantRepository } from "~/repositories";
import { writeAudit } from "~/utils/audit";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const rate = (cost: number | null, price: number) => (cost === null || price <= 0 ? null : Math.round((cost / price) * 10000) / 10000);

/** Nhà hàng dùng để tính giá vốn: người bị giới hạn luôn là nhà hàng của mình; admin chọn (bỏ trống = cả chuỗi) */
const costRestaurant = async (scope: Scope, requested?: number): Promise<number | null> => {
    const id = scope ?? requested ?? null;
    if (id && !(await restaurantRepository.getRestaurantById(id))) return rollback(RECIPE_ERROR.RESTAURANT_NOT_FOUND);
    return id;
};

const loadRecipe = async (dishId: number, restaurantId: number | null): Promise<IDishRecipe | undefined> => {
    const dish = await recipeRepository.getDishPrice(dishId, restaurantId);
    if (!dish) return undefined;
    const items = await recipeRepository.getRecipeItems(dishId, restaurantId);
    const cost = round2(items.reduce((s, i) => s + Number(i.cost), 0));
    return { dish_id: dish.id, name: dish.name, price: dish.price, items, cost, food_cost_rate: items.length ? rate(cost, Number(dish.price)) : null };
};

export const getRecipe = async (dishId: number, scope: Scope, restaurantId?: number): Promise<IDishRecipe | number> => {
    try {
        return await withTransaction(async () => {
            const rid = await costRestaurant(scope, restaurantId);
            return (await loadRecipe(dishId, rid)) ?? rollback(RECIPE_ERROR.DISH_NOT_FOUND);
        });
    } catch (error) {
        return RECIPE_ERROR.FAILED;
    }
};

/** Thay toàn bộ định lượng của món (định lượng dùng chung cả chuỗi, như thực đơn). Ghi nhật ký trước / sau. */
export const updateRecipe = async (
    dishId: number,
    body: IRecipeBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IDishRecipe | number> => {
    try {
        return await withTransaction(async () => {
            const rid = await costRestaurant(scope);
            const before = await loadRecipe(dishId, rid);
            if (!before) return rollback(RECIPE_ERROR.DISH_NOT_FOUND);

            const ids = body.items.map((i) => i.ingredient_id);
            const found = await inventoryRepository.getIngredientsByIds(ids);
            if (found.length !== new Set(ids).size) return rollback(RECIPE_ERROR.INVALID_INGREDIENTS);

            const items = body.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: round3(i.quantity) }));
            await recipeRepository.replaceRecipe(dishId, items);
            await writeAudit(audit, {
                action: "dish.recipe_update",
                entity_type: "dish",
                entity_id: dishId,
                // Định lượng dùng chung cả chuỗi
                restaurant_id: null,
                before: { items: before.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: Number(i.quantity) })) },
                after: { items },
            });
            return (await loadRecipe(dishId, rid))!;
        });
    } catch (error) {
        return RECIPE_ERROR.FAILED;
    }
};

/** Bảng giá vốn lý thuyết (theo giá bình quân hiện tại) của mọi món và combo */
export const getMenuCosts = async (scope: Scope, restaurantId?: number): Promise<IMenuCosts | number> => {
    try {
        return await withTransaction(async () => {
            const rid = await costRestaurant(scope, restaurantId);
            const rows = await recipeRepository.getMenuCosts(rid);
            const items = rows.map((r) => ({
                ...r,
                margin: r.cost === null ? null : round2(r.price - r.cost),
                food_cost_rate: rate(r.cost, r.price),
            }));
            const rates = items.map((i) => i.food_cost_rate).filter((x): x is number => x !== null);
            return {
                restaurant_id: rid,
                items,
                summary: {
                    items: items.length,
                    missing_recipe: items.filter((i) => i.cost === null).length,
                    avg_food_cost_rate: rates.length ? Math.round((rates.reduce((s, x) => s + x, 0) / rates.length) * 10000) / 10000 : null,
                },
            };
        });
    } catch (error) {
        return RECIPE_ERROR.FAILED;
    }
};

/**
 * Trừ kho cho các dòng món vừa chuyển sang `served` (câu hỏi 6). GỌI TRONG transaction đổi trạng thái món.
 * - Lượng trừ = định lượng × số phần (combo theo bản chụp thành phần). Thiếu kho vẫn trừ, tồn có thể âm (câu hỏi 9).
 * - Mỗi nguyên liệu một giao dịch `consume` (reference: dòng món), đơn giá = giá vốn bình quân lúc đó.
 * - Giá vốn của dòng (`cost`) = Σ lượng × giá bình quân; dòng không có định lượng giữ `cost` NULL.
 * - Khóa các dòng tồn kho một lần cho cả lô, theo thứ tự id (tránh deadlock với phiếu kho chạy cùng lúc).
 */
export const consumeServedLines = async (lines: IServedLine[], actorId: number | null): Promise<IConsumeResult[]> => {
    if (lines.length === 0) return [];
    const needs = await recipeRepository.getLineRequirements(lines);
    if (needs.length === 0) return [];

    const lineRestaurant = new Map(lines.map((l) => [`${l.kind}:${l.id}`, l.restaurant_id]));
    const results: IConsumeResult[] = [];
    for (const restaurantId of [...new Set(lines.map((l) => l.restaurant_id))].sort((a, b) => a - b)) {
        const own = needs.filter((n) => lineRestaurant.get(`${n.kind}:${n.line_id}`) === restaurantId);
        if (own.length === 0) continue;
        const rows = await inventoryRepository.lockInventoryRows(restaurantId, [...new Set(own.map((n) => n.ingredient_id))]);
        const qty = new Map([...rows.values()].map((r) => [r.ingredient_id, Number(r.quantity)]));
        const costs = new Map<string, { kind: "dish" | "combo"; id: number; cost: number }>();
        const txns = [];
        for (const n of own) {
            const row = rows.get(n.ingredient_id)!;
            const avg = Number(row.avg_unit_cost);
            const need = Number(n.quantity);
            const after = round3(qty.get(n.ingredient_id)! - need);
            qty.set(n.ingredient_id, after);
            const key = `${n.kind}:${n.line_id}`;
            const entry = costs.get(key) ?? { kind: n.kind, id: n.line_id, cost: 0 };
            entry.cost += need * avg;
            costs.set(key, entry);
            txns.push({
                restaurant_id: restaurantId,
                ingredient_id: n.ingredient_id,
                receipt_id: null,
                type: "consume",
                quantity_change: -need,
                quantity_after: after,
                unit_price: avg,
                reason: null,
                created_by: actorId,
                reference_type: n.kind === "dish" ? "order_item" : "order_combo",
                reference_id: n.line_id,
            });
        }
        for (const [ingredientId, after] of qty) {
            await inventoryRepository.updateInventoryRow(restaurantId, ingredientId, after, Number(rows.get(ingredientId)!.avg_unit_cost));
        }
        // Giai đoạn 11: nguyên liệu theo dõi hạn dùng -> trừ lô hết hạn sớm nhất trước (FEFO)
        const tracked = new Set(
            (await inventoryRepository.getIngredientsByIds([...qty.keys()])).filter((g) => g.track_expiry).map((g) => g.id),
        );
        for (const n of own) {
            if (tracked.has(n.ingredient_id)) await lotRepository.takeFromLots(restaurantId, n.ingredient_id, Number(n.quantity));
        }
        await inventoryRepository.insertTransactions(txns);
        for (const c of costs.values()) await recipeRepository.setLineCost(c.kind, c.id, round2(c.cost));

        const low = [...qty.entries()]
            .filter(([id, after]) => {
                const min = Number(rows.get(id)!.min_quantity);
                return after < 0 || (min > 0 && after <= min);
            })
            .map(([id]) => id);
        results.push({ restaurant_id: restaurantId, ingredient_ids: [...qty.keys()], low_ingredient_ids: low });
    }
    return results;
};
