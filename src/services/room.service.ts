import { MAX_TABLES_PER_PRIVATE_ROOM } from "~/common/constant";
import { ImageEntityEnum, RoomTypeEnum } from "~/common/enum";
import { destroyImage } from "~/utils/cloudinary";
import { GET_ALL_ROOMS, ROOM_ERROR } from "~/common/error-code/room";
import { rollback, withTransaction } from "~/config/db";
import { ICreateRoomBody, IGetRooms, IRoom, ISelectQuery, IUpdateRoomBody } from "~/interfaces";
import { imageRepository, reservationRepository, restaurantRepository, roomRepository } from "~/repositories";
import { buildPagination } from "~/utils/pagination";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

export const inScope = (restaurantId: number, scope: Scope): boolean =>
    scope === null || scope === undefined || restaurantId === scope;

const isPrivateType = (type: string) => type !== RoomTypeEnum.PUBLIC;

export const getAllRooms = async (restaurantId?: number | null): Promise<IRoom[] | number> => {
    try {
        return await roomRepository.getAllRooms(restaurantId);
    } catch (error) {
        return GET_ALL_ROOMS.GET_ALL_ROOMS_FAILED;
    }
};

export const getRooms = async (params: ISelectQuery): Promise<IGetRooms | number> => {
    try {
        const result = await roomRepository.getRooms(params);
        return { rooms: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return GET_ALL_ROOMS.GET_ALL_ROOMS_FAILED;
    }
};

/** Phòng nằm ngoài phạm vi được coi như không tồn tại (không lộ dữ liệu nhà hàng khác). */
export const getRoomById = async (id: number, scope: Scope): Promise<IRoom | number> => {
    try {
        const room = await roomRepository.getRoomById(id);
        if (!room || !inScope(room.restaurant_id, scope)) return ROOM_ERROR.NOT_FOUND;
        return room;
    } catch (error) {
        return ROOM_ERROR.FAILED;
    }
};

export const createRoom = async (body: ICreateRoomBody, scope: Scope): Promise<IRoom | number> => {
    try {
        const restaurantId = scope ?? body.restaurant_id;
        if (!restaurantId) return ROOM_ERROR.RESTAURANT_REQUIRED;

        const restaurant = await restaurantRepository.getRestaurantById(restaurantId);
        if (!restaurant) return ROOM_ERROR.RESTAURANT_NOT_FOUND;

        return await roomRepository.createRoom({ ...body, restaurant_id: restaurantId });
    } catch (error) {
        return ROOM_ERROR.FAILED;
    }
};

export const updateRoom = async (id: number, body: IUpdateRoomBody, scope: Scope): Promise<IRoom | number> => {
    try {
        return await withTransaction(async () => {
            const room = await roomRepository.getRoomById(id, true);
            if (!room || !inScope(room.restaurant_id, scope)) return rollback(ROOM_ERROR.NOT_FOUND);

            // Chuyển sang phòng riêng thì không được vượt quá số bàn tối đa
            const nextType = body.type ?? room.type;
            if (isPrivateType(nextType) && (room.table_count ?? 0) > MAX_TABLES_PER_PRIVATE_ROOM) {
                return rollback(ROOM_ERROR.TOO_MANY_TABLES);
            }

            // Tạm khóa phòng còn lịch đặt bàn chưa kết thúc: cảnh báo, người dùng xác nhận thì gửi lại kèm `force`
            const { force, ...changes } = body;
            body = changes;
            if (body.is_active === false && room.is_active && !force) {
                if ((await reservationRepository.countUpcomingByRoom(id)) > 0) {
                    return rollback(ROOM_ERROR.HAS_UPCOMING_RESERVATIONS);
                }
            }

            if (body.restaurant_id && body.restaurant_id !== room.restaurant_id) {
                const restaurant = await restaurantRepository.getRestaurantById(body.restaurant_id);
                if (!restaurant) return rollback(ROOM_ERROR.RESTAURANT_NOT_FOUND);
            }

            const updated = await roomRepository.updateRoom(id, body);
            return updated ?? rollback(ROOM_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return ROOM_ERROR.FAILED;
    }
};

/** Xóa phòng và các bàn trong phòng; không cho xóa khi còn bàn đang có khách / đã đặt. */
export const deleteRoom = async (id: number, scope: Scope): Promise<{ id: number } | number> => {
    try {
        let publicIds: string[] = [];
        const result = await withTransaction(async () => {
            const room = await roomRepository.getRoomById(id, true);
            if (!room || !inScope(room.restaurant_id, scope)) return rollback(ROOM_ERROR.NOT_FOUND);

            if ((await roomRepository.countBusyTables(id)) > 0) return rollback(ROOM_ERROR.IN_USE);
            if ((await reservationRepository.countUpcomingByRoom(id)) > 0) return rollback(ROOM_ERROR.HAS_RESERVATIONS);

            const deleted = await roomRepository.deleteRoomWithTables(id);
            if (!deleted) return rollback(ROOM_ERROR.NOT_FOUND);
            publicIds = await imageRepository.deleteImagesOf(ImageEntityEnum.ROOM, id);
            return deleted;
        });
        if (typeof result !== "number") await Promise.all(publicIds.map(destroyImage));
        return result;
    } catch (error) {
        return ROOM_ERROR.FAILED;
    }
};
