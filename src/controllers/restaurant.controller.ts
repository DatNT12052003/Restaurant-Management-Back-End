import { Request, Response } from "express";
import { PAGINATION } from "~/common/constant";
import { createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { IGetQuery, IGetRestaurants, ISelectQuery } from "~/interfaces";
import { getRestaurantsResource } from "~/resources/restaurant.resource";
import { restaurantService } from "~/services";

export const getRestaurants = async (req: Request, res: Response) => {
    try {
        const query: IGetQuery = req.query;
        const currentPage = query.currentPage || PAGINATION.DEFAULT_PAGE;
        const limit = query.limit || PAGINATION.DEFAULT_LIMIT;
        const offset = (currentPage - 1) * limit;

        const params: ISelectQuery = {
            search: query.search,
            filters: query.filters,
            orderBy: query.orderBy,
            limit,
            offset,
            returning: ["id", "name", "status", "address", "created_at", "updated_at", "deleted_at"],
        };

        const restaurants: IGetRestaurants | null = await restaurantService.getRestaurants(params);

        if (!restaurants) {
            return createErrorResponse(res, req.t("restaurant:error_getting_restaurants"));
        }

        return getSuccessResponse(res, req.t("restaurant:get_restaurants_successfully"), restaurants);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const getAllRestaurants = async (req: Request, res: Response) => {
    try {
        const restaurants = await restaurantService.getAllRestaurants();
        if (!restaurants) {
            return createErrorResponse(res, req.t("restaurant:error_getting_restaurants"));
        }
        return getSuccessResponse(
            res,
            req.t("restaurant:get_restaurants_successfully"),
            getRestaurantsResource(restaurants),
        );
    } catch (error) {
        serverErrorResponse(res);
    }
};
