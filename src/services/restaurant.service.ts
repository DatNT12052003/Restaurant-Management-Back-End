import { GET_ALL_RESTAURANTS, GET_RESTAURANTS, RESTAURANT_ERROR } from "~/common/error-code/restaurant";
import { ICreateRestaurantBody, ISelectQuery, IUpdateRestaurantBody } from "~/interfaces";
import { IGetRestaurants, IRestaurant } from "~/interfaces/restaurant.interface";
import { restaurantRepository } from "~/repositories";
import { getRestaurantsResource } from "~/resources/restaurant.resource";
import { buildPagination } from "~/utils/pagination";

export const getRestaurants = async (params: ISelectQuery): Promise<IGetRestaurants | number> => {
    try {
        const result = await restaurantRepository.getRestaurants(params);
        return {
            restaurants: getRestaurantsResource(result.rows),
            pagination: buildPagination(params, result.totalCount),
        };
    } catch (error) {
        return GET_RESTAURANTS.GET_RESTAURANTS_FAILED;
    }
};

/** `restaurantId`: null = tất cả (admin); số = chỉ nhà hàng đó. */
export const getAllRestaurants = async (restaurantId?: number | null): Promise<IRestaurant[] | number> => {
    try {
        return await restaurantRepository.getAllRestaurants(restaurantId);
    } catch (error) {
        return GET_ALL_RESTAURANTS.GET_ALL_RESTAURANTS_FAILED;
    }
};

export const getRestaurantById = async (id: number): Promise<IRestaurant | number> => {
    try {
        return (await restaurantRepository.getRestaurantById(id)) ?? RESTAURANT_ERROR.NOT_FOUND;
    } catch (error) {
        return RESTAURANT_ERROR.FAILED;
    }
};

export const createRestaurant = async (body: ICreateRestaurantBody): Promise<IRestaurant | number> => {
    try {
        return await restaurantRepository.createRestaurant(body);
    } catch (error) {
        return RESTAURANT_ERROR.FAILED;
    }
};

export const updateRestaurant = async (id: number, body: IUpdateRestaurantBody): Promise<IRestaurant | number> => {
    try {
        return (await restaurantRepository.updateRestaurant(id, body)) ?? RESTAURANT_ERROR.NOT_FOUND;
    } catch (error) {
        return RESTAURANT_ERROR.FAILED;
    }
};

/** Chỉ cho xóa khi nhà hàng không còn phòng và nhân viên (tránh dữ liệu mồ côi). */
export const deleteRestaurant = async (id: number): Promise<{ id: number } | number> => {
    try {
        const restaurant = await restaurantRepository.getRestaurantById(id);
        if (!restaurant) return RESTAURANT_ERROR.NOT_FOUND;

        const deps = await restaurantRepository.countRestaurantDependencies(id);
        if (deps.rooms > 0 || deps.users > 0) return RESTAURANT_ERROR.HAS_DEPENDENCIES;

        return (await restaurantRepository.deleteRestaurant(id)) ?? RESTAURANT_ERROR.NOT_FOUND;
    } catch (error) {
        return RESTAURANT_ERROR.FAILED;
    }
};
