import { Request, Response } from "express";
import { CLOSED_DAY_ERROR, RECIPE_ERROR } from "~/common/error-code/recipe";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { listClosedDaysSchema, menuCostsSchema, recipeQuerySchema } from "~/schemas";
import { closedDayService, recipeService } from "~/services";
import { auditContext } from "~/utils/audit";

type Responder = typeof badRequestResponse;

const RECIPE_MESSAGES: Record<number, [Responder, string]> = {
    [RECIPE_ERROR.DISH_NOT_FOUND]: [notFoundResponse, "menu:dish_not_found"],
    [RECIPE_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [RECIPE_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "recipe:invalid_ingredients"],
};

const CLOSED_DAY_MESSAGES: Record<number, [Responder, string]> = {
    [CLOSED_DAY_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [CLOSED_DAY_ERROR.DUPLICATE]: [badRequestResponse, "recipe:closed_day_duplicate"],
    [CLOSED_DAY_ERROR.NOT_FOUND]: [notFoundResponse, "recipe:closed_day_not_found"],
};

const handle = async (
    req: Request,
    res: Response,
    messages: Record<number, [Responder, string]>,
    action: "get" | "update" | "create" | "delete",
    prefix: string,
    run: () => Promise<unknown>,
) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = messages[result] ?? [createErrorResponse, `recipe:${prefix}${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`recipe:${prefix}${action}_successfully`);
        if (action === "get") return getSuccessResponse(res, message, result);
        if (action === "create") return createSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

// ---- Định lượng và giá vốn ----

export const getMenuCosts = (req: Request, res: Response) => {
    const q = menuCostsSchema.shape.query.parse(req.query);
    return handle(req, res, RECIPE_MESSAGES, "get", "", () => recipeService.getMenuCosts(req.restaurantScope, q.restaurant_id));
};

export const getRecipe = (req: Request, res: Response) => {
    const q = recipeQuerySchema.shape.query.parse(req.query);
    return handle(req, res, RECIPE_MESSAGES, "get", "", () =>
        recipeService.getRecipe(Number(req.params.id), req.restaurantScope, q.restaurant_id),
    );
};

export const updateRecipe = (req: Request, res: Response) =>
    handle(req, res, RECIPE_MESSAGES, "update", "", () =>
        recipeService.updateRecipe(Number(req.params.id), req.body, req.restaurantScope, auditContext(req)),
    );

// ---- Ngày nghỉ của chi nhánh ----

const restaurantId = (req: Request) => Number(req.params.restaurantId);

export const getClosedDays = (req: Request, res: Response) => {
    const q = listClosedDaysSchema.shape.query.parse(req.query);
    return handle(req, res, CLOSED_DAY_MESSAGES, "get", "closed_day_", () =>
        closedDayService.getClosedDays(restaurantId(req), q.from, q.to),
    );
};

export const createClosedDay = (req: Request, res: Response) =>
    handle(req, res, CLOSED_DAY_MESSAGES, "create", "closed_day_", () =>
        closedDayService.createClosedDay(restaurantId(req), req.body, req.user?.id),
    );

export const deleteClosedDay = (req: Request, res: Response) =>
    handle(req, res, CLOSED_DAY_MESSAGES, "delete", "closed_day_", () =>
        closedDayService.deleteClosedDay(restaurantId(req), String(req.params.day)),
    );
