import { GET_ALL_ROOMS } from "~/common/error-code/room";
import { IRoom } from "~/interfaces";
import { roomRepository } from "~/repositories";

export const getAllRooms = async (): Promise<IRoom[] | number> => {
    try {
        const rooms = await roomRepository.getAllRooms();
        return rooms;
    } catch (error) {
        return GET_ALL_ROOMS.GET_ALL_ROOMS_FAILED;
    }
};
