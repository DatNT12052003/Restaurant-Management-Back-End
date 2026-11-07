import { db } from "~/config/db";
import {
    ICombo,
    IComboBody,
    IDish,
    IDishBody,
    IRestaurantMenuItem,
    IRestaurantMenuItemBody,
    ISelectQuery,
    ITag,
} from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

/** Ảnh đại diện của đối tượng (ưu tiên ảnh primary, sau đó ảnh đầu tiên) */
const primaryImage = (entityType: "dish" | "combo", alias: string) => `(
    SELECT i.url FROM images i
    WHERE i.entity_type = '${entityType}' AND i.entity_id = ${alias}.id AND i.deleted_at IS NULL
    ORDER BY i.is_primary DESC, i.sort_order, i.id
    LIMIT 1
) AS image_url`;

const DISH_TAGS = `COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
    FROM dish_tags dt
    JOIN tags t ON t.id = dt.tag_id AND t.deleted_at IS NULL
    WHERE dt.dish_id = d.id
), '[]'::json) AS tags`;

const COMBO_ITEMS = `COALESCE((
    SELECT json_agg(json_build_object(
        'dish_id', ci.dish_id, 'quantity', ci.quantity, 'name', dd.name, 'price', dd.price, 'status', dd.status
    ) ORDER BY dd.name)
    FROM combo_items ci
    JOIN dishes dd ON dd.id = ci.dish_id
    WHERE ci.combo_id = c.id
), '[]'::json) AS items`;

const COMBO_ITEMS_TOTAL = `COALESCE((
    SELECT SUM(dd.price * ci.quantity)
    FROM combo_items ci JOIN dishes dd ON dd.id = ci.dish_id
    WHERE ci.combo_id = c.id
), 0)::numeric(12,2) AS items_total`;

const DISH_FIELDS = ["name", "description", "price", "category", "status", "updated_at"];
const COMBO_FIELDS = ["name", "description", "price", "status", "updated_at"];

const mapFields = (params: ISelectQuery, fieldMap: Record<string, string>): ISelectQuery => ({
    ...params,
    search: params.search?.text
        ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
        : undefined,
    filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
    orderBy: (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field),
});

const withTotal = <T>(rows: (T & { total_count?: string })[]) => ({
    rows: rows.map(({ total_count, ...data }) => data as T),
    totalCount: rows.length > 0 ? parseInt(rows[0].total_count!, 10) : 0,
});

// ---------------------------------------------------------------------------
// Thẻ
// ---------------------------------------------------------------------------

export const getTags = async (): Promise<ITag[]> => {
    const result = await db().query(`
        SELECT t.id, t.name,
            (SELECT COUNT(*)::int FROM dish_tags dt JOIN dishes d ON d.id = dt.dish_id AND d.deleted_at IS NULL
             WHERE dt.tag_id = t.id) AS dish_count
        FROM tags t
        WHERE t.deleted_at IS NULL
        ORDER BY lower(t.name)
    `);
    return result.rows;
};

export const countTagsByIds = async (ids: number[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const result = await db().query(
        "SELECT COUNT(*)::int AS count FROM tags WHERE id = ANY($1::int[]) AND deleted_at IS NULL",
        [ids],
    );
    return result.rows[0].count;
};

export const createTag = async (name: string): Promise<ITag> => {
    const result = await db().query("INSERT INTO tags (name) VALUES ($1) RETURNING id, name", [name]);
    return result.rows[0];
};

export const updateTag = async (id: number, name: string): Promise<ITag | undefined> => {
    const result = await db().query(
        "UPDATE tags SET name = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING id, name",
        [name, id],
    );
    return result.rows[0];
};

/** Xóa mềm thẻ và gỡ thẻ khỏi mọi món */
export const deleteTag = async (id: number): Promise<{ id: number } | undefined> => {
    await db().query("DELETE FROM dish_tags WHERE tag_id = $1", [id]);
    const result = await db().query(
        "UPDATE tags SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Món ăn
// ---------------------------------------------------------------------------

export const getDishes = async (params: ISelectQuery): Promise<{ rows: IDish[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        name: "d.name",
        description: "d.description",
        price: "d.price",
        category: "d.category",
        status: "d.status",
        created_at: "d.created_at",
        updated_at: "d.updated_at",
    };
    const { query, values } = buildSelectAllQuery("dishes d", Object.values(fieldMap), {
        ...mapFields(params, fieldMap),
        returning: ["d.*", primaryImage("dish", "d"), DISH_TAGS],
    });
    const result = await db().query(query, values);
    return withTotal<IDish>(result.rows);
};

export const getDishById = async (id: number): Promise<IDish | undefined> => {
    const result = await db().query(
        `SELECT d.*, ${primaryImage("dish", "d")}, ${DISH_TAGS} FROM dishes d WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [id],
    );
    return result.rows[0];
};

/** Món còn tồn tại (chưa xóa) trong danh sách id */
export const getExistingDishIds = async (ids: number[]): Promise<number[]> => {
    if (ids.length === 0) return [];
    const result = await db().query("SELECT id FROM dishes WHERE id = ANY($1::int[]) AND deleted_at IS NULL", [ids]);
    return result.rows.map((r) => r.id);
};

export const createDish = async (payload: IDishBody): Promise<IDish> => {
    const { query, values } = buildInsertQuery("dishes", payload, DISH_FIELDS);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateDish = async (id: number, payload: IDishBody): Promise<IDish | undefined> => {
    const { query, values } = buildUpdateQuery(
        "dishes",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        DISH_FIELDS,
        ["*"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const replaceDishTags = async (dishId: number, tagIds: number[]): Promise<void> => {
    await db().query("DELETE FROM dish_tags WHERE dish_id = $1", [dishId]);
    if (tagIds.length > 0) {
        await db().query("INSERT INTO dish_tags (dish_id, tag_id) SELECT $1, unnest($2::int[])", [dishId, tagIds]);
    }
};

/** Các combo (chưa xóa) đang chứa món */
export const getCombosContainingDish = async (dishId: number): Promise<{ id: number; name: string }[]> => {
    const result = await db().query(
        `SELECT c.id, c.name FROM combo_items ci
        JOIN combos c ON c.id = ci.combo_id AND c.deleted_at IS NULL
        WHERE ci.dish_id = $1`,
        [dishId],
    );
    return result.rows;
};

export const deleteDish = async (id: number): Promise<{ id: number } | undefined> => {
    await db().query("DELETE FROM dish_tags WHERE dish_id = $1", [id]);
    const result = await db().query(
        "UPDATE dishes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

export const getCombos = async (params: ISelectQuery): Promise<{ rows: ICombo[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        name: "c.name",
        description: "c.description",
        price: "c.price",
        status: "c.status",
        created_at: "c.created_at",
        updated_at: "c.updated_at",
    };
    const { query, values } = buildSelectAllQuery("combos c", Object.values(fieldMap), {
        ...mapFields(params, fieldMap),
        returning: ["c.*", primaryImage("combo", "c"), COMBO_ITEMS, COMBO_ITEMS_TOTAL],
    });
    const result = await db().query(query, values);
    return withTotal<ICombo>(result.rows);
};

export const getComboById = async (id: number): Promise<ICombo | undefined> => {
    const result = await db().query(
        `SELECT c.*, ${primaryImage("combo", "c")}, ${COMBO_ITEMS}, ${COMBO_ITEMS_TOTAL}
        FROM combos c WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [id],
    );
    return result.rows[0];
};

export const createCombo = async (payload: Omit<IComboBody, "items">): Promise<ICombo> => {
    const { query, values } = buildInsertQuery("combos", payload, COMBO_FIELDS);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateCombo = async (id: number, payload: Omit<IComboBody, "items">): Promise<ICombo | undefined> => {
    const { query, values } = buildUpdateQuery(
        "combos",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        COMBO_FIELDS,
        ["*"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const replaceComboItems = async (comboId: number, items: { dish_id: number; quantity: number }[]) => {
    await db().query("DELETE FROM combo_items WHERE combo_id = $1", [comboId]);
    if (items.length > 0) {
        await db().query(
            `INSERT INTO combo_items (combo_id, dish_id, quantity)
            SELECT $1, i.dish_id, i.quantity FROM unnest($2::int[], $3::int[]) AS i(dish_id, quantity)`,
            [comboId, items.map((i) => i.dish_id), items.map((i) => i.quantity)],
        );
    }
};

export const deleteCombo = async (id: number): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        "UPDATE combos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

// ---------------------------------------------------------------------------
// Thực đơn theo nhà hàng
// ---------------------------------------------------------------------------

const menuItemsQuery = (kind: "dish" | "combo") => {
    const [table, alias, link, col] =
        kind === "dish"
            ? ["dishes", "d", "restaurant_dishes", "dish_id"]
            : ["combos", "c", "restaurant_combos", "combo_id"];
    return `
        SELECT ${alias}.id, ${alias}.name, ${alias}.status, ${kind === "dish" ? `${alias}.category,` : ""}
            ${primaryImage(kind, alias)},
            ${alias}.price AS base_price,
            rm.price AS override_price,
            COALESCE(rm.price, ${alias}.price) AS price,
            COALESCE(rm.is_available, true) AS is_available
        FROM ${table} ${alias}
        LEFT JOIN ${link} rm ON rm.${col} = ${alias}.id AND rm.restaurant_id = $1
        WHERE ${alias}.deleted_at IS NULL
        ORDER BY lower(${alias}.name)
    `;
};

export const getRestaurantMenu = async (
    restaurantId: number,
): Promise<{ dishes: IRestaurantMenuItem[]; combos: IRestaurantMenuItem[] }> => {
    const [dishes, combos] = await Promise.all([
        db().query(menuItemsQuery("dish"), [restaurantId]),
        db().query(menuItemsQuery("combo"), [restaurantId]),
    ]);
    return { dishes: dishes.rows, combos: combos.rows };
};

/**
 * Lưu tùy chỉnh của nhà hàng cho một món / combo.
 * Đang bán + không có giá riêng = giống mặc định -> xóa dòng để bảng gọn.
 */
export const upsertRestaurantMenuItem = async (
    kind: "dish" | "combo",
    restaurantId: number,
    itemId: number,
    body: Required<IRestaurantMenuItemBody>,
): Promise<void> => {
    const [table, col] = kind === "dish" ? ["restaurant_dishes", "dish_id"] : ["restaurant_combos", "combo_id"];
    if (body.is_available && body.price === null) {
        await db().query(`DELETE FROM ${table} WHERE restaurant_id = $1 AND ${col} = $2`, [restaurantId, itemId]);
        return;
    }
    await db().query(
        `INSERT INTO ${table} (restaurant_id, ${col}, is_available, price)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (restaurant_id, ${col})
        DO UPDATE SET is_available = EXCLUDED.is_available, price = EXCLUDED.price, updated_at = NOW()`,
        [restaurantId, itemId, body.is_available, body.price],
    );
};

export const getRestaurantMenuItem = async (
    kind: "dish" | "combo",
    restaurantId: number,
    itemId: number,
): Promise<{ is_available: boolean; price: string | null } | undefined> => {
    const [table, col] = kind === "dish" ? ["restaurant_dishes", "dish_id"] : ["restaurant_combos", "combo_id"];
    const result = await db().query(
        `SELECT is_available, price FROM ${table} WHERE restaurant_id = $1 AND ${col} = $2`,
        [restaurantId, itemId],
    );
    return result.rows[0];
};
