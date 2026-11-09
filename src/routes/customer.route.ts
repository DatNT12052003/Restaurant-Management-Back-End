import { Router } from "express";
import {
    FeedbackPermissionEnum,
    LoyaltyPermissionEnum,
    OrderRequestPermissionEnum,
    PaymentPermissionEnum,
    TablePermissionEnum,
} from "~/common/permission-enum";
import { customerController as c } from "~/controllers";
import {
    authMiddleware,
    checkPermission,
    loadUserContext,
    optionalGuest,
    publicWriteRateLimit,
    restrictToRestaurant,
    sensitiveAuthRateLimit,
    validate,
} from "~/middlewares";
import {
    accountFeedbackSchema,
    adjustPointsSchema,
    attachGuestSchema,
    bookingCancelSchema,
    bookingLookupSchema,
    bookingOtpSchema,
    bookingSlotsSchema,
    createOrderRequestSchema,
    customerCancelSchema,
    idParamSchema,
    listFeedbacksSchema,
    listOrderRequestsSchema,
    loyaltySettingsSchema,
    myOrderRequestsSchema,
    onlineBookingSchema,
    redeemPointsSchema,
    rejectOrderRequestSchema,
    replyFeedbackSchema,
    restaurantIdParamSchema,
    searchGuestsSchema,
    tableFeedbackSchema,
    tableTokenSchema,
} from "~/schemas";
import { z } from "zod";

const idSchema = z.object({ params: idParamSchema });

/**
 * Giai đoạn 13: API công khai (`/api/public`), không cần đăng nhập. Có token của tài khoản khách thì `optionalGuest`
 * gán `req.user` (đặt bàn không cần OTP, order gắn vào tài khoản).
 */
export const publicRouter = Router();
publicRouter.use(optionalGuest);
publicRouter.get("/restaurants", c.getRestaurants);
publicRouter.get("/restaurants/:restaurantId/menu", validate(restaurantIdParamSchema), c.getMenu);
publicRouter.get("/restaurants/:restaurantId/slots", validate(bookingSlotsSchema), c.getSlots);
publicRouter.post("/booking/otp", sensitiveAuthRateLimit, validate(bookingOtpSchema), c.sendOtp);
publicRouter.post("/reservations", publicWriteRateLimit, validate(onlineBookingSchema), c.createBooking);
publicRouter.get("/reservations/:code", sensitiveAuthRateLimit, validate(bookingLookupSchema), c.lookupBooking);
publicRouter.post("/reservations/:code/cancel", sensitiveAuthRateLimit, validate(bookingCancelSchema), c.cancelBooking);
publicRouter.get("/tables/:token", validate(tableTokenSchema), c.getTable);
publicRouter.get("/tables/:token/requests", validate(myOrderRequestsSchema), c.getMyRequests);
publicRouter.post("/tables/:token/requests", publicWriteRateLimit, validate(createOrderRequestSchema), c.createRequest);
publicRouter.post("/tables/:token/feedback", publicWriteRateLimit, validate(tableFeedbackSchema), c.submitTableFeedback);

/** Tài khoản khách (`/api/customer`): chỉ role `guest` */
export const customerRouter = Router();
customerRouter.use(authMiddleware, loadUserContext, c.requireGuest);
customerRouter.get("/me", c.getProfile);
customerRouter.get("/reservations", c.getMyReservations);
customerRouter.post("/reservations/:id/cancel", validate(customerCancelSchema), c.cancelMyReservation);
customerRouter.get("/orders", c.getMyOrders);
customerRouter.post("/orders/:id/feedback", validate(accountFeedbackSchema), c.submitOrderFeedback);
customerRouter.get("/points", c.getMyPoints);

/** Món khách gọi qua QR, chờ nhân viên duyệt (`/api/order-requests`) */
export const orderRequestRouter = Router();
orderRequestRouter.use(authMiddleware);
const HANDLE = checkPermission(OrderRequestPermissionEnum.HANDLE);
orderRequestRouter.get("/", HANDLE, validate(listOrderRequestsSchema), restrictToRestaurant, c.getOrderRequests);
orderRequestRouter.post("/:id/accept", HANDLE, validate(idSchema), restrictToRestaurant, c.acceptOrderRequest);
orderRequestRouter.post("/:id/reject", HANDLE, validate(rejectOrderRequestSchema), restrictToRestaurant, c.rejectOrderRequest);
// Đổi mã QR của bàn (bản in cũ hết dùng được)
orderRequestRouter.post("/tables/:id/rotate-qr", checkPermission(TablePermissionEnum.UPDATE), validate(idSchema), restrictToRestaurant, c.rotateTableQr);

/** Phản hồi của khách (`/api/feedbacks`) */
export const feedbackRouter = Router();
feedbackRouter.use(authMiddleware);
feedbackRouter.get("/", checkPermission(FeedbackPermissionEnum.VIEW), validate(listFeedbacksSchema), restrictToRestaurant, c.getFeedbacks);
feedbackRouter.patch("/:id", checkPermission(FeedbackPermissionEnum.REPLY), validate(replyFeedbackSchema), restrictToRestaurant, c.replyFeedback);

/** Điểm thưởng (`/api/loyalty`) */
export const loyaltyRouter = Router();
loyaltyRouter.use(authMiddleware);
loyaltyRouter.get("/settings", checkPermission(LoyaltyPermissionEnum.VIEW), c.getLoyaltySettings);
loyaltyRouter.patch("/settings", checkPermission(LoyaltyPermissionEnum.MANAGE), validate(loyaltySettingsSchema), c.updateLoyaltySettings);
loyaltyRouter.get("/guests", checkPermission(LoyaltyPermissionEnum.VIEW), validate(searchGuestsSchema), c.searchGuests);
loyaltyRouter.get("/guests/:id", checkPermission(LoyaltyPermissionEnum.VIEW), validate(idSchema), c.getLoyaltyGuest);
loyaltyRouter.post("/guests/:id/adjust", checkPermission(LoyaltyPermissionEnum.MANAGE), validate(adjustPointsSchema), c.adjustPoints);
// Thu ngân đổi điểm trên order đang mở
loyaltyRouter.post("/orders/:id/redeem", checkPermission(PaymentPermissionEnum.CREATE), validate(redeemPointsSchema), restrictToRestaurant, c.redeemPoints);

// Thu ngân gắn / gỡ khách của order (tích điểm)
loyaltyRouter.post("/orders/:id/guest", checkPermission(PaymentPermissionEnum.CREATE), validate(attachGuestSchema), restrictToRestaurant, c.attachGuest);
