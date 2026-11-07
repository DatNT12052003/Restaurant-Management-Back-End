import { OrderStatusEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IDiscount, IDiscountBody, ISelectQuery } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

const WRITABLE_FIELDS = [
    "code",
    "name",
    "description",
    "restaurant_id",
    "type",
    "value",
    "min_order_value",
    "max_discount",
    "start_at",
    "end_at",
    "usage_limit",
    "per_user_limit",
    "status",
    "created_by",
    "updated_at",
];

const RETURNING = ["dc.*", "(SELECT r.name FROM restaurants r WHERE r.id = dc.restaurant_id) AS restaurant_name"];

export const getDiscounts = async (params: ISelectQuery): Promise<{ rows: IDiscount[]; totalCount: number }> => {
    const fieldMap: Record<string, string> = {
        code: "dc.code",
        name: "dc.name",
        type: "dc.type",
        status: "dc.status",
        restaurant_id: "dc.restaurant_id",
        start_at: "dc.start_at",
        end_at: "dc.end_at",
        used_count: "dc.used_count",
        created_at: "dc.created_at",
    };
    const allowedFields = Object.values(fieldMap);
    const { query, values } = buildSelectAllQuery("discounts dc", allowedFields, {
        ...params,
        returning: RETURNING,
        search: params.search?.text
            ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
            : undefined,
        filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
        orderBy: (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field),
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

export const getDiscountById = async (id: number, forUpdate = false): Promise<IDiscount | undefined> => {
    const result = await db().query(
        `SELECT * FROM discounts WHERE id = $1 AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
        [id],
    );
    return result.rows[0];
};

/** Tìm theo mã (không phân biệt hoa thường), khóa dòng để kiểm tra / tăng lượt dùng an toàn */
export const getDiscountByCodeForUpdate = async (code: string): Promise<IDiscount | undefined> => {
    const result = await db().query(
        "SELECT * FROM discounts WHERE upper(code) = upper($1) AND deleted_at IS NULL FOR UPDATE",
        [code],
    );
    return result.rows[0];
};

export const createDiscount = async (body: IDiscountBody): Promise<{ id: number }> => {
    const { query, values } = buildInsertQuery("discounts", body, WRITABLE_FIELDS, ["id"]);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateDiscount = async (id: number, body: IDiscountBody): Promise<{ id: number } | undefined> => {
    const { query, values } = buildUpdateQuery(
        "discounts",
        { field: "id", value: id },
        { ...body, updated_at: new Date() },
        WRITABLE_FIELDS,
        ["id"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const deleteDiscount = async (id: number): Promise<{ id: number } | undefined> => {
    const result = await db().query(
        "UPDATE discounts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
    );
    return result.rows[0];
};

/** Tăng / giảm lượt dùng (không xuống dưới 0) */
export const changeUsage = async (id: number, delta: number): Promise<void> => {
    await db().query("UPDATE discounts SET used_count = GREATEST(used_count + $2, 0), updated_at = NOW() WHERE id = $1", [
        id,
        delta,
    ]);
};

/** Số order (chưa hủy) của khách đã dùng mã này, không tính order `excludeOrderId` */
export const countGuestUsage = async (discountId: number, guestUserId: number, excludeOrderId: number): Promise<number> => {
    const result = await db().query(
        `SELECT COUNT(*)::int AS count FROM order_discounts od
        JOIN orders o ON o.id = od.order_id AND o.deleted_at IS NULL
        WHERE od.discount_id = $1 AND o.guest_user_id = $2 AND o.status <> $3 AND o.id <> $4`,
        [discountId, guestUserId, OrderStatusEnum.CANCELLED, excludeOrderId],
    );
    return result.rows[0].count;
};

export const getOrderDiscount = async (orderId: number): Promise<{ id: number; discount_id: number } | undefined> => {
    const result = await db().query("SELECT id, discount_id FROM order_discounts WHERE order_id = $1", [orderId]);
    return result.rows[0];
};

export const setOrderDiscount = async (orderId: number, discountId: number, appliedBy: number | null): Promise<void> => {
    await db().query(
        `INSERT INTO order_discounts (order_id, discount_id, applied_by) VALUES ($1, $2, $3)
        ON CONFLICT (order_id) DO UPDATE SET discount_id = EXCLUDED.discount_id, applied_by = EXCLUDED.applied_by,
            amount_applied = 0, updated_at = NOW()`,
        [orderId, discountId, appliedBy],
    );
};

export const removeOrderDiscount = async (orderId: number): Promise<{ discount_id: number } | undefined> => {
    const result = await db().query("DELETE FROM order_discounts WHERE order_id = $1 RETURNING discount_id", [orderId]);
    return result.rows[0];
};
