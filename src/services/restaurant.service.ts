import { ISelectQuery } from "~/interfaces";
import { IGetRestaurants } from "~/interfaces/restaurant.interface";
import { restaurantRepository } from "~/repositories";

export const getRestaurants = async (params: ISelectQuery): Promise<IGetRestaurants | null> => {
    try {
        const result = await restaurantRepository.getRestaurants(params);
        const totalPages = Math.ceil(result.totalCount / params.limit!);

        const data: IGetRestaurants = {
            accounts: result.rows,
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: result.totalCount,
            },
        };
        return data;
    } catch (error) {
        return null;
    }
};
