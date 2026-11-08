import { db } from "~/config/db";
import { IMenuCostRow, IRecipeItem, IServedLine } from "~/interfaces";

/**
 * Giá vốn bình quân của nguyên liệu: theo nhà hàng; `restaurantId` null (admin xem cả chuỗi) thì lấy trung bình
 * giá bình quân của các chi nhánh đã có giá.
 */
const unitCost = (restaurantParam: string, ingredientCol: string) => `COALESCE(
    CASE WHEN ${restaurantParam}::int IS NULL
        THEN (SELECT AVG(v.avg_unit_cost) FROM inventory v WHERE v.ingredient_id = ${ingredientCol} AND v.avg_unit_cost > 0)
        ELSE (SELECT v.avg_unit_cost FROM inventory v WHERE v.ingredient_id = ${ingredientCol} AND v.restaurant_id = ${restaurantParam}::int)
    END, 0)`;

export const getRecipeItems = async (dishId: number, restaurantId: number | null): Promise<IRecipeItem[]> => {
    const result = await db().query(
        `SELECT di.ingredient_id, g.name, g.unit, g.status AS ingredient_status, di.quantity,
            ROUND(${unitCost("$2", "g.id")}, 2) AS unit_cost,
            ROUND(di.quantity * ${unitCost("$2", "g.id")}, 2) AS cost
        FROM dish_ingredients di JOIN ingredients g ON g.id = di.ingredient_id
        WHERE di.dish_id = $1
        ORDER BY lower(g.name)`,
        [dishId, restaurantId],
    );
    return result.rows;
};

/** Thay toàn bộ định lượng của món (bảng nối: xóa cứng rồi thêm lại) */
export const replaceRecipe = async (dishId: number, items: { ingredient_id: number; quantity: number }[]): Promise<void> => {
    await db().query("DELETE FROM dish_ingredients WHERE dish_id = $1", [dishId]);
    if (items.length === 0) return;
    await db().query(
        `INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity)
        SELECT $1, x.ingredient_id, x.quantity FROM json_to_recordset($2::json) AS x(ingredient_id int, quantity numeric)`,
        [dishId, JSON.stringify(items)],
    );
};

/** Giá bán của món tại nhà hàng (giá chi nhánh nếu có) */
export const getDishPrice = async (
    dishId: number,
    restaurantId: number | null,
): Promise<{ id: number; name: string; price: string } | undefined> => {
    const result = await db().query(
        `SELECT d.id, d.name, COALESCE(rd.price, d.price) AS price
        FROM dishes d LEFT JOIN restaurant_dishes rd ON rd.dish_id = d.id AND rd.restaurant_id = $2::int
        WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [dishId, restaurantId],
    );
    return result.rows[0];
};

/** Bảng giá vốn lý thuyết của mọi món và combo chưa xóa */
export const getMenuCosts = async (restaurantId: number | null): Promise<Omit<IMenuCostRow, "margin" | "food_cost_rate">[]> => {
    const result = await db().query(
        `WITH dish_cost AS (
            SELECT d.id, d.name, d.category::text AS category, d.status,
                COALESCE(rd.price, d.price) AS price,
                (SELECT COUNT(*)::int FROM dish_ingredients di WHERE di.dish_id = d.id) AS ingredient_count,
                (SELECT SUM(di.quantity * ${unitCost("$1", "di.ingredient_id")}) FROM dish_ingredients di WHERE di.dish_id = d.id) AS cost
            FROM dishes d LEFT JOIN restaurant_dishes rd ON rd.dish_id = d.id AND rd.restaurant_id = $1::int
            WHERE d.deleted_at IS NULL
        )
        SELECT 'dish' AS kind, id, name, category, status, price, cost, ingredient_count FROM dish_cost
        UNION ALL
        SELECT 'combo', c.id, c.name, 'combo', c.status, COALESCE(rc.price, c.price),
            -- Combo chỉ có giá vốn khi mọi món bên trong đều có định lượng
            CASE WHEN bool_and(dc.ingredient_count > 0) THEN SUM(dc.cost * ci.quantity) END,
            COALESCE(SUM(dc.ingredient_count), 0)::int
        FROM combos c
        LEFT JOIN restaurant_combos rc ON rc.combo_id = c.id AND rc.restaurant_id = $1::int
        JOIN combo_items ci ON ci.combo_id = c.id
        JOIN dish_cost dc ON dc.id = ci.dish_id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id, c.name, c.status, rc.price, c.price
        ORDER BY kind DESC, name`,
        [restaurantId],
    );
    return result.rows.map((r) => ({
        ...r,
        price: Number(r.price),
        cost: r.cost === null || (r.kind === "dish" && r.ingredient_count === 0) ? null : Math.round(Number(r.cost) * 100) / 100,
    }));
};

// ---------------------------------------------------------------------------
// Trừ kho khi phục vụ món
// ---------------------------------------------------------------------------

/**
 * Lượng nguyên liệu cần trừ cho các dòng món: định lượng × số phần. Combo: theo bản chụp thành phần lúc gọi món.
 * Bỏ qua nguyên liệu đã xóa. Dòng không có định lượng không có trong kết quả.
 */
export const getLineRequirements = async (
    lines: IServedLine[],
): Promise<{ kind: "dish" | "combo"; line_id: number; ingredient_id: number; quantity: string }[]> => {
    const dishIds = lines.filter((l) => l.kind === "dish").map((l) => l.id);
    const comboIds = lines.filter((l) => l.kind === "combo").map((l) => l.id);
    const result = await db().query(
        `SELECT 'dish' AS kind, i.id AS line_id, di.ingredient_id, ROUND(SUM(di.quantity * i.quantity), 3) AS quantity
        FROM order_items i
        JOIN dish_ingredients di ON di.dish_id = i.dish_id
        JOIN ingredients g ON g.id = di.ingredient_id AND g.deleted_at IS NULL
        WHERE i.id = ANY($1::int[])
        GROUP BY i.id, di.ingredient_id
        UNION ALL
        SELECT 'combo', c.id, di.ingredient_id, ROUND(SUM(di.quantity * (s.item->>'quantity')::numeric * c.quantity), 3)
        FROM order_combos c
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.items_snapshot, '[]'::jsonb)) AS s(item)
        JOIN dish_ingredients di ON di.dish_id = (s.item->>'dish_id')::int
        JOIN ingredients g ON g.id = di.ingredient_id AND g.deleted_at IS NULL
        WHERE c.id = ANY($2::int[])
        GROUP BY c.id, di.ingredient_id
        ORDER BY ingredient_id`,
        [dishIds, comboIds],
    );
    return result.rows;
};

export const setLineCost = async (kind: "dish" | "combo", lineId: number, cost: number): Promise<void> => {
    const table = kind === "dish" ? "order_items" : "order_combos";
    await db().query(`UPDATE ${table} SET cost = $2 WHERE id = $1`, [lineId, cost]);
};

/** Nguyên liệu đang có trong định lượng của món nào đó */
export const countDishesUsingIngredient = async (ingredientId: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS count FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id AND d.deleted_at IS NULL
        WHERE di.ingredient_id = $1`,
        [ingredientId],
    );
    return result.rows[0].count;
};
