import { IRestaurant } from "~/interfaces";

export const getRestaurantsResource = (
    restaurants: IRestaurant[],
): Pick<IRestaurant, "id" | "name" | "status" | "address">[] => {
    return restaurants.map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        status: restaurant.status,
        address: restaurant.address,
    }));
};
