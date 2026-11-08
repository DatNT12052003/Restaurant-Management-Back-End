import { PG_ERROR } from "~/common/constant";
import { CLOSED_DAY_ERROR } from "~/common/error-code/recipe";
import { rollback, withTransaction } from "~/config/db";
import { IClosedDay } from "~/interfaces";
import { closedDayRepository, restaurantRepository } from "~/repositories";
import { getPgErrorCode } from "~/utils/common";

/** Ngày nghỉ của chi nhánh: không tính vào giờ mở cửa khi tính tỷ lệ lấp đầy bàn (giai đoạn 10) */
export const getClosedDays = async (restaurantId: number, from?: string, to?: string): Promise<IClosedDay[] | number> => {
    try {
        if (!(await restaurantRepository.getRestaurantById(restaurantId))) return CLOSED_DAY_ERROR.RESTAURANT_NOT_FOUND;
        return await closedDayRepository.getClosedDays(restaurantId, from, to);
    } catch (error) {
        return CLOSED_DAY_ERROR.FAILED;
    }
};

export const createClosedDay = async (
    restaurantId: number,
    body: { day: string; note?: string | null },
    actorId: number | undefined,
): Promise<IClosedDay | number> => {
    try {
        return await withTransaction(async () => {
            if (!(await restaurantRepository.getRestaurantById(restaurantId))) return rollback(CLOSED_DAY_ERROR.RESTAURANT_NOT_FOUND);
            await closedDayRepository.createClosedDay({
                restaurant_id: restaurantId,
                day: body.day,
                note: body.note ?? null,
                created_by: actorId ?? null,
            });
            return (await closedDayRepository.getClosedDay(restaurantId, body.day))!;
        });
    } catch (error) {
        return getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION ? CLOSED_DAY_ERROR.DUPLICATE : CLOSED_DAY_ERROR.FAILED;
    }
};

export const deleteClosedDay = async (restaurantId: number, day: string): Promise<{ day: string } | number> => {
    try {
        return (await closedDayRepository.deleteClosedDay(restaurantId, day)) ? { day } : CLOSED_DAY_ERROR.NOT_FOUND;
    } catch (error) {
        return CLOSED_DAY_ERROR.FAILED;
    }
};
