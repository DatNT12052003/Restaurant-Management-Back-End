import { Request, Response } from "express";
import { RESERVATION_ERROR } from "~/common/error-code/reservation";
import { FilterOperatorEnum } from "~/common/enum";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { availableTablesSchema, listReservationsSchema, reservationScheduleSchema } from "~/schemas";
import { reservationService } from "~/services";
import { buildListParams } from "~/utils/pagination";

/** Mã lỗi service -> key i18n (namespace reservation) và hàm response */
const ERROR_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [RESERVATION_ERROR.NOT_FOUND]: [notFoundResponse, "reservation:not_found"],
    [RESERVATION_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "reservation:restaurant_required"],
    [RESERVATION_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [RESERVATION_ERROR.INVALID_TABLES]: [badRequestResponse, "reservation:invalid_tables"],
    [RESERVATION_ERROR.TABLE_CONFLICT]: [badRequestResponse, "reservation:table_conflict"],
    [RESERVATION_ERROR.INSUFFICIENT_CAPACITY]: [badRequestResponse, "reservation:insufficient_capacity"],
    [RESERVATION_ERROR.GUEST_NOT_FOUND]: [notFoundResponse, "reservation:guest_not_found"],
    [RESERVATION_ERROR.CONTACT_REQUIRED]: [badRequestResponse, "reservation:contact_required"],
    [RESERVATION_ERROR.NOT_EDITABLE]: [badRequestResponse, "reservation:not_editable"],
    [RESERVATION_ERROR.INVALID_TRANSITION]: [badRequestResponse, "reservation:invalid_transition"],
    [RESERVATION_ERROR.START_IN_PAST]: [badRequestResponse, "reservation:start_in_past"],
    [RESERVATION_ERROR.NO_SHOW_TOO_EARLY]: [badRequestResponse, "reservation:no_show_too_early"],
    [RESERVATION_ERROR.TABLES_OCCUPIED]: [badRequestResponse, "reservation:tables_occupied"],
    [RESERVATION_ERROR.CANNOT_DELETE]: [badRequestResponse, "reservation:cannot_delete"],
    [RESERVATION_ERROR.INVALID_TIME]: [badRequestResponse, "reservation:invalid_time"],
};

/** Chạy service và trả response chuẩn */
const handle = async (
    req: Request,
    res: Response,
    action: "get" | "create" | "update" | "status" | "delete",
    run: () => Promise<unknown>,
) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = ERROR_MESSAGES[result] ?? [createErrorResponse, `reservation:${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`reservation:${action}_successfully`);
        if (action === "create") return createSuccessResponse(res, message, result);
        if (action === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

/**
 * Express 5 parse lại `req.query` mỗi lần đọc nên giá trị đã chuyển kiểu bởi `validate` không được giữ lại.
 * Parse lại bằng chính schema (đã chạy qua `validate` nên không lỗi) để có số / Date đúng kiểu.
 */
export const getReservations = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listReservationsSchema.shape.query.parse(req.query);
    // Admin lọc theo ?restaurant_id=; người bị giới hạn luôn bị ép về nhà hàng của mình
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    // Reservation có thời gian giao với [from, to)
    if (extra.from) filters.push({ field: "end_time", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "start_time", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });

    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", () => reservationService.getReservations(params, extra.table_id));
};

export const getSchedule = (req: Request, res: Response) => {
    const q = reservationScheduleSchema.shape.query.parse(req.query);
    return handle(req, res, "get", () =>
        reservationService.getSchedule({ restaurantId: q.restaurant_id, from: q.from, to: q.to }, req.restaurantScope),
    );
};

export const getAvailableTables = (req: Request, res: Response) => {
    const q = availableTablesSchema.shape.query.parse(req.query);
    return handle(req, res, "get", () =>
        reservationService.getAvailableTables({ ...q, restaurantId: q.restaurant_id }, req.restaurantScope),
    );
};

export const getReservationById = (req: Request, res: Response) =>
    handle(req, res, "get", () => reservationService.getReservationById(id(req), req.restaurantScope));

export const createReservation = (req: Request, res: Response) =>
    handle(req, res, "create", () =>
        reservationService.createReservation(req.body, req.restaurantScope, req.user?.id),
    );

export const updateReservation = (req: Request, res: Response) =>
    handle(req, res, "update", () => reservationService.updateReservation(id(req), req.body, req.restaurantScope));

export const updateReservationStatus = (req: Request, res: Response) =>
    handle(req, res, "status", () =>
        reservationService.updateReservationStatus(id(req), req.body, req.restaurantScope),
    );

export const deleteReservation = (req: Request, res: Response) =>
    handle(req, res, "delete", () => reservationService.deleteReservation(id(req), req.restaurantScope));
