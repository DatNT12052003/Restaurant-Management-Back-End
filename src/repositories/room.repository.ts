import { UsageStatusEnum } from "~/common/enum";
import { db } from "~/config/db";
import { ICreateRoomBody, IRoom, ISelectQuery, IUpdateRoomBody } from "~/interfaces";
import { buildInsertQuery, buildSelectAllQuery, buildUpdateQuery } from "~/utils/query-builder";

const WRITABLE_FIELDS = ["name", "type", "description", "status", "is_active", "restaurant_id", "updated_at"];

/** Số bàn (chưa xóa) trong phòng, trả kèm qua subquery */
const TABLE_COUNT = `(SELECT COUNT(*)::int FROM tables t WHERE t.room_id = rooms.id AND t.deleted_at IS NULL) AS table_count`;

/** `restaurantId` = null/undefined: lấy tất cả nhà hàng (chỉ dùng cho admin). */
export const getAllRooms = async (restaurantId?: number | null): Promise<IRoom[]> => {
    if (restaurantId) {
        const result = await db().query(
            `SELECT rooms.*, ${TABLE_COUNT} FROM rooms WHERE deleted_at IS NULL AND restaurant_id = $1 ORDER BY id`,
            [restaurantId],
        );
        return result.rows;
    }
    const result = await db().query(`SELECT rooms.*, ${TABLE_COUNT} FROM rooms WHERE deleted_at IS NULL ORDER BY id`);
    return result.rows;
};

export const getRooms = async (params: ISelectQuery): Promise<{ rows: IRoom[]; totalCount: number }> => {
    const allowedFields = [
        "name",
        "type",
        "status",
        "is_active",
        "description",
        "restaurant_id",
        "created_at",
        "updated_at",
        "deleted_at",
    ];
    const baseTable = "rooms";
    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, {
        ...params,
        returning: ["rooms.*", TABLE_COUNT],
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};

/** `forUpdate`: khóa dòng (dùng trong transaction khi kiểm tra sức chứa trước khi thêm bàn). */
export const getRoomById = async (id: number, forUpdate = false): Promise<IRoom | undefined> => {
    if (forUpdate) {
        await db().query("SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
    }
    const result = await db().query(`SELECT rooms.*, ${TABLE_COUNT} FROM rooms WHERE id = $1 AND deleted_at IS NULL`, [
        id,
    ]);
    return result.rows[0];
};

export const createRoom = async (payload: ICreateRoomBody): Promise<IRoom> => {
    const { query, values } = buildInsertQuery("rooms", payload, WRITABLE_FIELDS);
    const result = await db().query(query, values);
    return result.rows[0];
};

export const updateRoom = async (id: number, payload: IUpdateRoomBody): Promise<IRoom | undefined> => {
    const { query, values } = buildUpdateQuery(
        "rooms",
        { field: "id", value: id },
        { ...payload, updated_at: new Date() },
        WRITABLE_FIELDS,
        ["*"],
        true,
    );
    const result = await db().query(query, values);
    return result.rows[0];
};

/** Số bàn đang có khách hoặc đã được đặt trong phòng. */
export const countBusyTables = async (roomId: number): Promise<number> => {
    const result = await db().query(
        "SELECT COUNT(*)::int AS count FROM tables WHERE room_id = $1 AND deleted_at IS NULL AND status = ANY($2)",
        [roomId, [UsageStatusEnum.OCCUPIED, UsageStatusEnum.RESERVED]],
    );
    return result.rows[0].count;
};

/** Xóa mềm phòng cùng toàn bộ bàn trong phòng. Gọi trong transaction. */
export const deleteRoomWithTables = async (roomId: number): Promise<{ id: number } | undefined> => {
    await db().query("UPDATE tables SET deleted_at = NOW() WHERE room_id = $1 AND deleted_at IS NULL", [roomId]);
    const result = await db().query(
        "UPDATE rooms SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, deleted_at",
        [roomId],
    );
    return result.rows[0];
};
