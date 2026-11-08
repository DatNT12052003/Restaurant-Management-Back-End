import { db } from "~/config/db";
import { ICreateRestaurantBody, IRestaurant, ISelectQuery, IUpdateRestaurantBody } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildSoftDeleteQuery, buildUpdateQuery } from "~/utils/query-builder";

const WRITABLE_FIELDS = ["name", "address", "status", "service_fee_percent", "tax_percent", "open_time", "close_time", "updated_at"];

export const getRestaurants = async (params: ISelectQuery): Promise<{ rows: IRestaurant[]; totalCount: number }> => {
    const allowedFields = ["name", "status", "address", "created_at", "updated_at", "deleted_at"];
    const baseTable = "restaurants";

    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);

    return { rows, totalCount };
};

/** `restaurantId`: chỉ trả về nhà hàng này (người dùng bị giới hạn phạm vi). */
export const getAllRestaurants = async (restaurantId?: number | null): Promise<IRestaurant[]> => {
    if (restaurantId) {
        const result = await db().query("SELECT * FROM restaurants WHERE deleted_at IS NULL AND id = $1", [
            restaurantId,
        ]);
        return result.rows;
    }
    const result = await db().query("SELECT * FROM restaurants WHERE deleted_at IS NULL ORDER BY id");
    return result.rows;
};

export const getRestaurantById = async (id: number): Promise<IRestaurant | undefined> => {
    const result = await db().query("SELECT * FROM restaurants WHERE id = $1 AND deleted_at IS NULL", [id]);
    return result.rows[0];
};

export const createRestaurant = async (payload: ICreateRestaurantBody): Promise<IRestaurant> => {
    const { query, values } = buildInsertQuery("restaurants", payload, WRITABLE_FIELDS);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateRestaurant = async (id: number, payload: IUpdateRestaurantBody): Promise<IRestaurant | undefined> => {
    const { query, values } = buildUpdateQuery(
        "restaurants",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        WRITABLE_FIELDS,
        ["*"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

export const deleteRestaurant = async (id: number): Promise<{ id: number } | undefined> => {
    const { query, values } = buildSoftDeleteQuery("restaurants", id);
    const result = await db().query(query, values);
    return result.rows[0];
};

/** Số phòng và số nhân viên còn hoạt động của nhà hàng (dùng để chặn xóa). */
export const countRestaurantDependencies = async (id: number): Promise<{ rooms: number; users: number }> => {
    const result = await db().query(
        `SELECT
            (SELECT COUNT(*)::int FROM rooms WHERE restaurant_id = $1 AND deleted_at IS NULL) AS rooms,
            (SELECT COUNT(*)::int FROM users WHERE restaurant_id = $1 AND deleted_at IS NULL) AS users`,
        [id],
    );
    return result.rows[0];
};
