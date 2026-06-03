import { GET_ALL_ROOMS } from "~/common/error-code/room";
import { IGetRooms, IRoom, ISelectQuery } from "~/interfaces";
import { roomRepository } from "~/repositories";

export const getAllRooms = async (): Promise<IRoom[] | number> => {
    try {
        const rooms = await roomRepository.getAllRooms();
        return rooms;
    } catch (error) {
        return GET_ALL_ROOMS.GET_ALL_ROOMS_FAILED;
    }
};

export const getRooms = async (params: ISelectQuery): Promise<IGetRooms | number> => {
    try {
        const result = await roomRepository.getRooms(params);
        const totalPages = Math.ceil(result.totalCount / params.limit!);

        const data: IGetRooms = {
            rooms: result.rows,
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: result.totalCount,
            },
        };
        return data;
    } catch (error) {
        return GET_ALL_ROOMS.GET_ALL_ROOMS_FAILED;
    }
};
