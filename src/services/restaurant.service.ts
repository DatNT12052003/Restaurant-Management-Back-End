import { GET_ALL_RESTAURANTS, GET_RESTAURANTS } from "~/common/error-code/restaurant";
import { ISelectQuery } from "~/interfaces";
import { IGetRestaurants, IRestaurant } from "~/interfaces/restaurant.interface";
import { restaurantRepository } from "~/repositories";
import { getRestaurantsResource } from "~/resources/restaurant.resource";

export const getRestaurants = async (params: ISelectQuery): Promise<IGetRestaurants | number> => {
    try {
        const result = await restaurantRepository.getRestaurants(params);
        const totalPages = Math.ceil(result.totalCount / params.limit!);

        const data: IGetRestaurants = {
            restaurants: getRestaurantsResource(result.rows),
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: result.totalCount,
            },
        };
        return data;
    } catch (error) {
        return GET_RESTAURANTS.GET_RESTAURANTS_FAILED;
    }
};

export const getAllRestaurants = async (): Promise<IRestaurant[] | number> => {
    try {
        const restaurants = await restaurantRepository.getAllRestaurants();
        return restaurants;
    } catch (error) {
        return GET_ALL_RESTAURANTS.GET_ALL_RESTAURANTS_FAILED;
    }
};
