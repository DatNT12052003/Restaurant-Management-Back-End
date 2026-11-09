import { Request, Response } from "express";
import { BOOKING_ERROR, FEEDBACK_ERROR, LOYALTY_ERROR, ORDER_REQUEST_ERROR, PUBLIC_ERROR } from "~/common/error-code/customer";
import {
    authorizationErrorResponse,
    badRequestResponse,
    conflictResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
    tooManyRequestsResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { listFeedbacksSchema, listOrderRequestsSchema } from "~/schemas";
import { bookingService, customerService, feedbackService, loyaltyService, orderRequestService } from "~/services";
import { auditContext } from "~/utils/audit";
import { todayVn, addDays } from "~/utils/hr-time";

/** Giai đoạn 13: kênh khách hàng. Thông báo `customer:<nhóm>_<thao tác>_successfully` / `_failed`. */

type Responder = typeof badRequestResponse;
type Group = "public" | "booking" | "otp" | "request" | "feedback" | "loyalty" | "account";
type Action = "get" | "create" | "update" | "cancel" | "accept" | "reject" | "redeem" | "adjust" | "rotate" | "attach";

const MESSAGES: Record<Group, Record<number, [Responder, string]>> = {
    public: {
        [PUBLIC_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "customer:restaurant_not_found"],
        [PUBLIC_ERROR.TABLE_NOT_FOUND]: [notFoundResponse, "customer:table_not_found"],
    },
    booking: {
        [BOOKING_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "customer:restaurant_not_found"],
        [BOOKING_ERROR.DISABLED]: [badRequestResponse, "customer:booking_disabled"],
        [BOOKING_ERROR.INVALID_TIME]: [badRequestResponse, "customer:booking_invalid_time"],
        [BOOKING_ERROR.TOO_MANY_GUESTS]: [badRequestResponse, "customer:booking_too_many_guests"],
        [BOOKING_ERROR.NO_TABLE]: [conflictResponse, "customer:booking_no_table"],
        [BOOKING_ERROR.OTP_INVALID]: [badRequestResponse, "customer:otp_invalid"],
        [BOOKING_ERROR.CONTACT_REQUIRED]: [badRequestResponse, "customer:booking_contact_required"],
        [BOOKING_ERROR.NOT_FOUND]: [notFoundResponse, "customer:booking_not_found"],
        [BOOKING_ERROR.CANNOT_CANCEL]: [badRequestResponse, "customer:booking_cannot_cancel"],
    },
    otp: {
        [BOOKING_ERROR.TOO_MANY_OTP]: [tooManyRequestsResponse, "customer:otp_too_many"],
        [BOOKING_ERROR.MAIL_FAILED]: [createErrorResponse, "customer:otp_mail_failed"],
    },
    request: {
        [ORDER_REQUEST_ERROR.TABLE_NOT_FOUND]: [notFoundResponse, "customer:table_not_found"],
        [ORDER_REQUEST_ERROR.DISABLED]: [badRequestResponse, "customer:qr_ordering_disabled"],
        [ORDER_REQUEST_ERROR.ITEM_UNAVAILABLE]: [badRequestResponse, "customer:item_unavailable"],
        [ORDER_REQUEST_ERROR.TOO_MANY_PENDING]: [tooManyRequestsResponse, "customer:request_too_many"],
        [ORDER_REQUEST_ERROR.NOT_FOUND]: [notFoundResponse, "customer:request_not_found"],
        [ORDER_REQUEST_ERROR.INVALID_STATUS]: [badRequestResponse, "customer:request_invalid_status"],
        [ORDER_REQUEST_ERROR.TABLE_UNAVAILABLE]: [badRequestResponse, "customer:request_table_unavailable"],
        [ORDER_REQUEST_ERROR.EMPTY]: [badRequestResponse, "customer:request_empty"],
    },
    feedback: {
        [FEEDBACK_ERROR.ORDER_NOT_ELIGIBLE]: [badRequestResponse, "customer:feedback_not_eligible"],
        [FEEDBACK_ERROR.ALREADY_SUBMITTED]: [conflictResponse, "customer:feedback_already"],
        [FEEDBACK_ERROR.NOT_FOUND]: [notFoundResponse, "customer:feedback_not_found"],
    },
    loyalty: {
        [LOYALTY_ERROR.GUEST_NOT_FOUND]: [notFoundResponse, "customer:guest_not_found"],
        [LOYALTY_ERROR.DISABLED]: [badRequestResponse, "customer:loyalty_disabled"],
        [LOYALTY_ERROR.NO_GUEST]: [badRequestResponse, "customer:loyalty_no_guest"],
        [LOYALTY_ERROR.INSUFFICIENT_POINTS]: [badRequestResponse, "customer:loyalty_insufficient"],
        [LOYALTY_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "customer:loyalty_order_not_found"],
        [LOYALTY_ERROR.HAS_PAYMENTS]: [badRequestResponse, "customer:loyalty_has_payments"],
        [LOYALTY_ERROR.NEGATIVE_BALANCE]: [badRequestResponse, "customer:loyalty_negative"],
    },
    account: {
        [BOOKING_ERROR.NOT_FOUND]: [notFoundResponse, "customer:booking_not_found"],
        [BOOKING_ERROR.CANNOT_CANCEL]: [badRequestResponse, "customer:booking_cannot_cancel"],
    },
};

const handle = async (req: Request, res: Response, group: Group, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = MESSAGES[group][result] ?? (group === "otp" ? MESSAGES.booking[result] : undefined) ?? [createErrorResponse, `customer:${group}_${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`customer:${group}_${action}_successfully`);
        if (action === "get") return getSuccessResponse(res, message, result);
        if (action === "create") return createSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);
const ip = (req: Request) => (req.ip ?? null)?.slice(0, 64) ?? null;
/** Khách đã đăng nhập (do `optionalGuest` / `loadUserContext` gán) */
const guest = (req: Request) =>
    req.user && req.roles?.includes("guest")
        ? { id: req.user.id, full_name: req.user.full_name, phone_number: req.user.phone_number ?? null, email: req.user.email ?? null }
        : null;

// ---------------------------------------------------------------------------
// Công khai
// ---------------------------------------------------------------------------

export const getRestaurants = (req: Request, res: Response) => handle(req, res, "public", "get", () => bookingService.getRestaurants());
export const getMenu = (req: Request, res: Response) =>
    handle(req, res, "public", "get", () => bookingService.getMenu(Number(req.params.restaurantId)));
export const getSlots = (req: Request, res: Response) =>
    handle(req, res, "booking", "get", () => bookingService.getSlots(Number(req.params.restaurantId), String(req.query.date), Number(req.query.guest_count)));
export const sendOtp = (req: Request, res: Response) => handle(req, res, "otp", "create", () => bookingService.sendOtp(req.body.email, ip(req)));
export const createBooking = (req: Request, res: Response) =>
    handle(req, res, "booking", "create", () => bookingService.createOnlineBooking(req.body, guest(req)));
export const lookupBooking = (req: Request, res: Response) =>
    handle(req, res, "booking", "get", () => bookingService.lookupBooking(req.params.code as string, String(req.query.phone)));
export const cancelBooking = (req: Request, res: Response) =>
    handle(req, res, "booking", "cancel", () => bookingService.cancelBooking(req.params.code as string, req.body.phone, req.body.reason));

export const getTable = (req: Request, res: Response) => handle(req, res, "request", "get", () => orderRequestService.getTable(req.params.token as string));
export const createRequest = (req: Request, res: Response) =>
    handle(req, res, "request", "create", () => orderRequestService.createRequest(req.params.token as string, req.body, guest(req)?.id ?? null, ip(req)));
export const getMyRequests = (req: Request, res: Response) =>
    handle(req, res, "request", "get", () => orderRequestService.getMyRequests(req.params.token as string, String(req.query.client_token)));
export const submitTableFeedback = (req: Request, res: Response) =>
    handle(req, res, "feedback", "create", () => {
        const { order_id, ...body } = req.body;
        return feedbackService.submitAtTable(req.params.token as string, Number(order_id), body, guest(req)?.id ?? null);
    });

// ---------------------------------------------------------------------------
// Tài khoản khách
// ---------------------------------------------------------------------------

/** Chỉ tài khoản khách dùng được /api/customer */
export const requireGuest = (req: Request, res: Response, next: () => void) => {
    if (!guest(req)) return authorizationErrorResponse(res, req.t("customer:guest_only"));
    next();
};

export const getProfile = (req: Request, res: Response) => handle(req, res, "account", "get", () => customerService.getProfile(req.user!.id));
export const getMyReservations = (req: Request, res: Response) => handle(req, res, "account", "get", () => customerService.getReservations(req.user!.id));
export const cancelMyReservation = (req: Request, res: Response) =>
    handle(req, res, "account", "cancel", () => customerService.cancelMyReservation(req.user!.id, id(req), req.body?.reason));
export const getMyOrders = (req: Request, res: Response) => handle(req, res, "account", "get", () => customerService.getOrders(req.user!.id));
export const getMyPoints = (req: Request, res: Response) => handle(req, res, "account", "get", () => customerService.getPoints(req.user!.id));
export const submitOrderFeedback = (req: Request, res: Response) =>
    handle(req, res, "feedback", "create", () => feedbackService.submitForAccount(req.user!.id, id(req), req.body));

// ---------------------------------------------------------------------------
// Nhân viên
// ---------------------------------------------------------------------------

export const getOrderRequests = (req: Request, res: Response) => {
    const q = listOrderRequestsSchema.shape.query.parse(req.query);
    return handle(req, res, "request", "get", () => orderRequestService.getRequests(req.restaurantScope, q));
};
export const acceptOrderRequest = (req: Request, res: Response) =>
    handle(req, res, "request", "accept", () => orderRequestService.acceptRequest(id(req), req.restaurantScope, req.user!.id));
export const rejectOrderRequest = (req: Request, res: Response) =>
    handle(req, res, "request", "reject", () => orderRequestService.rejectRequest(id(req), req.body?.reason, req.restaurantScope, req.user!.id));

export const rotateTableQr = (req: Request, res: Response) =>
    handle(req, res, "request", "rotate", () => orderRequestService.rotateTableQr(id(req), req.restaurantScope));

export const getFeedbacks = (req: Request, res: Response) => {
    const q = listFeedbacksSchema.shape.query.parse(req.query);
    const to = q.to ?? todayVn();
    const from = q.from ?? addDays(to, -29);
    return handle(req, res, "feedback", "get", () =>
        feedbackService.getFeedbacks(
            { restaurantId: req.restaurantScope ?? q.restaurant_id ?? null, from, to, status: q.status, complaintOnly: q.complaint_only, maxRating: q.max_rating },
            { limit: q.limit ?? 20, currentPage: q.currentPage ?? 1 },
        ),
    );
};
export const replyFeedback = (req: Request, res: Response) =>
    handle(req, res, "feedback", "update", () => feedbackService.replyFeedback(id(req), req.body, req.restaurantScope, auditContext(req)));

export const getLoyaltySettings = (req: Request, res: Response) => handle(req, res, "loyalty", "get", () => loyaltyService.getSettings());
export const updateLoyaltySettings = (req: Request, res: Response) =>
    handle(req, res, "loyalty", "update", () => loyaltyService.updateSettings(req.body, auditContext(req)));
export const searchGuests = (req: Request, res: Response) => handle(req, res, "loyalty", "get", () => loyaltyService.searchGuests(String(req.query.q)));
export const getLoyaltyGuest = (req: Request, res: Response) => handle(req, res, "loyalty", "get", () => loyaltyService.getGuest(id(req)));
export const adjustPoints = (req: Request, res: Response) =>
    handle(req, res, "loyalty", "adjust", () => loyaltyService.adjustPoints(id(req), req.body.points, req.body.note, auditContext(req)));
export const redeemPoints = (req: Request, res: Response) =>
    handle(req, res, "loyalty", "redeem", () => loyaltyService.redeemOnOrder(id(req), req.body.points, req.restaurantScope, auditContext(req)));
export const attachGuest = (req: Request, res: Response) =>
    handle(req, res, "loyalty", "attach", () => loyaltyService.attachGuest(id(req), req.body.guest_user_id ?? null, req.restaurantScope, auditContext(req)));
