import { IRestaurant } from "~/interfaces";

export const getRestaurantsResource = (
    restaurants: IRestaurant[],
): Pick<IRestaurant, "id" | "name" | "status" | "address" | "created_at" | "updated_at" | "deleted_at">[] => {
    return restaurants.map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        status: restaurant.status,
        address: restaurant.address,
        created_at: restaurant.created_at,
        updated_at: restaurant.updated_at,
        deleted_at: restaurant.deleted_at,
    }));
};
