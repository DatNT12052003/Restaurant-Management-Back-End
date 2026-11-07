import { MAX_TABLES_PER_PRIVATE_ROOM, PG_ERROR } from "~/common/constant";
import { RoomTypeEnum, UsageStatusEnum } from "~/common/enum";
import { GET_ALL_TABLES, TABLE_ERROR } from "~/common/error-code/table";
import { rollback, withTransaction } from "~/config/db";
import { ICreateTableBody, IGetTables, ISelectQuery, ITable, IUpdateTableBody } from "~/interfaces";
import { reservationRepository, roomRepository, tableRepository } from "~/repositories";
import { getPgErrorCode } from "~/utils/common";
import { buildPagination } from "~/utils/pagination";
import { inScope } from "./room.service";

type Scope = number | null | undefined;

const BUSY_STATUSES: string[] = [UsageStatusEnum.OCCUPIED, UsageStatusEnum.RESERVED];

const isDuplicateName = (error: unknown) => getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION;

/**
 * Khóa phòng và kiểm tra phòng còn nhận thêm bàn không. Gọi trong transaction.
 * Trả về undefined nếu hợp lệ, hoặc mã lỗi.
 */
const checkRoomCapacity = async (roomId: number, scope: Scope): Promise<number | undefined> => {
    const room = await roomRepository.getRoomById(roomId, true);
    if (!room || !inScope(room.restaurant_id, scope)) return TABLE_ERROR.ROOM_NOT_FOUND;
    if (room.type !== RoomTypeEnum.PUBLIC && (room.table_count ?? 0) >= MAX_TABLES_PER_PRIVATE_ROOM) {
        return TABLE_ERROR.ROOM_FULL;
    }
    return undefined;
};

export const getAllTables = async (restaurantId?: number | null): Promise<ITable[] | number> => {
    try {
        return await tableRepository.getAllTables(restaurantId);
    } catch (error) {
        return GET_ALL_TABLES.GET_ALL_TABLES_FAILED;
    }
};

export const getTables = async (params: ISelectQuery): Promise<IGetTables | number> => {
    try {
        const result = await tableRepository.getTables(params);
        return { tables: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return GET_ALL_TABLES.GET_ALL_TABLES_FAILED;
    }
};

export const getTableById = async (id: number, scope: Scope): Promise<ITable | number> => {
    try {
        const table = await tableRepository.getTableById(id);
        if (!table || !inScope(table.restaurant_id!, scope)) return TABLE_ERROR.NOT_FOUND;
        return table;
    } catch (error) {
        return TABLE_ERROR.FAILED;
    }
};

export const createTable = async (body: ICreateTableBody, scope: Scope): Promise<ITable | number> => {
    try {
        return await withTransaction(async () => {
            const capacityError = await checkRoomCapacity(body.room_id, scope);
            if (capacityError !== undefined) return rollback(capacityError);
            return await tableRepository.createTable(body);
        });
    } catch (error) {
        return isDuplicateName(error) ? TABLE_ERROR.DUPLICATE_NAME : TABLE_ERROR.FAILED;
    }
};

export const updateTable = async (id: number, body: IUpdateTableBody, scope: Scope): Promise<ITable | number> => {
    try {
        return await withTransaction(async () => {
            const table = await tableRepository.getTableById(id);
            if (!table || !inScope(table.restaurant_id!, scope)) return rollback(TABLE_ERROR.NOT_FOUND);

            if (body.room_id && body.room_id !== table.room_id) {
                const capacityError = await checkRoomCapacity(body.room_id, scope);
                if (capacityError !== undefined) return rollback(capacityError);
            }

            const updated = await tableRepository.updateTable(id, body);
            return updated ?? rollback(TABLE_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return isDuplicateName(error) ? TABLE_ERROR.DUPLICATE_NAME : TABLE_ERROR.FAILED;
    }
};

export const deleteTable = async (id: number, scope: Scope): Promise<{ id: number } | number> => {
    try {
        const table = await tableRepository.getTableById(id);
        if (!table || !inScope(table.restaurant_id!, scope)) return TABLE_ERROR.NOT_FOUND;
        if (BUSY_STATUSES.includes(table.status)) return TABLE_ERROR.IN_USE;
        if ((await reservationRepository.countUpcomingByTables([id])) > 0) return TABLE_ERROR.HAS_RESERVATIONS;
        return (await tableRepository.deleteTable(id)) ?? TABLE_ERROR.NOT_FOUND;
    } catch (error) {
        return TABLE_ERROR.FAILED;
    }
};
