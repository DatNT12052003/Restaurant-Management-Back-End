import { Request, Response } from "express";
import { HR_ERROR } from "~/common/error-code/hr";
import { PayrollPermissionEnum } from "~/common/permission-enum";
import {
    authorizationErrorResponse,
    badRequestResponse,
    conflictResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IHrActor, IStaffMember } from "~/interfaces";
import {
    colleagueShiftsSchema,
    hrRestaurantQuerySchema,
    hrStaffQuerySchema,
    listAdjustmentsSchema,
    listAttendanceSchema,
    listLeavesSchema,
    listPayrollsSchema,
    listShiftsSchema,
    listSwapsSchema,
    monthQuerySchema,
    myMonthSchema,
    myRangeSchema,
} from "~/schemas";
import { attendanceService, hrService, payrollService } from "~/services";
import { auditContext } from "~/utils/audit";

/** Giai đoạn 12: nhân sự. Mỗi nhóm có thông báo `hr:<nhóm>_<thao tác>_successfully` / `_failed`. */

type Responder = typeof badRequestResponse;
type Group =
    | "settings"
    | "staff"
    | "template"
    | "shift"
    | "swap"
    | "attendance"
    | "clock"
    | "leave"
    | "review"
    | "performance"
    | "compensation"
    | "allowance"
    | "adjustment"
    | "payroll";
type Action = "get" | "create" | "update" | "delete" | "approve" | "reject" | "cancel" | "accept" | "decline" | "calculate" | "finalize" | "copy" | "rotate";

const MESSAGES: Record<number, [Responder, string]> = {
    [HR_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "hr:restaurant_required"],
    [HR_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [HR_ERROR.STAFF_NOT_FOUND]: [notFoundResponse, "hr:staff_not_found"],
    [HR_ERROR.CANNOT_MANAGE]: [authorizationErrorResponse, "hr:cannot_manage"],
    [HR_ERROR.TEMPLATE_NOT_FOUND]: [notFoundResponse, "hr:template_not_found"],
    [HR_ERROR.TEMPLATE_DUPLICATE]: [conflictResponse, "hr:template_duplicate"],
    [HR_ERROR.SHIFT_NOT_FOUND]: [notFoundResponse, "hr:shift_not_found"],
    [HR_ERROR.SHIFT_OVERLAP]: [conflictResponse, "hr:shift_overlap"],
    [HR_ERROR.SHIFT_HAS_ATTENDANCE]: [badRequestResponse, "hr:shift_has_attendance"],
    [HR_ERROR.SHIFT_INVALID_TIME]: [badRequestResponse, "hr:shift_invalid_time"],
    [HR_ERROR.SWAP_NOT_FOUND]: [notFoundResponse, "hr:swap_not_found"],
    [HR_ERROR.INVALID_STATUS]: [badRequestResponse, "hr:invalid_status"],
    [HR_ERROR.SWAP_INVALID_SHIFT]: [badRequestResponse, "hr:swap_invalid_shift"],
    [HR_ERROR.QR_INVALID]: [badRequestResponse, "hr:qr_invalid"],
    [HR_ERROR.ATTENDANCE_NOT_FOUND]: [notFoundResponse, "hr:attendance_not_found"],
    [HR_ERROR.ATTENDANCE_INVALID]: [badRequestResponse, "hr:attendance_invalid"],
    [HR_ERROR.NO_OVERTIME]: [badRequestResponse, "hr:no_overtime"],
    [HR_ERROR.LEAVE_NOT_FOUND]: [notFoundResponse, "hr:leave_not_found"],
    [HR_ERROR.LEAVE_OVERLAP]: [conflictResponse, "hr:leave_overlap"],
    [HR_ERROR.PAYROLL_LOCKED]: [badRequestResponse, "hr:payroll_locked"],
    [HR_ERROR.PAYROLL_NOT_FOUND]: [notFoundResponse, "hr:payroll_not_found"],
    [HR_ERROR.ALLOWANCE_NOT_FOUND]: [notFoundResponse, "hr:allowance_not_found"],
    [HR_ERROR.ADJUSTMENT_NOT_FOUND]: [notFoundResponse, "hr:adjustment_not_found"],
    [HR_ERROR.COMPENSATION_DUPLICATE]: [conflictResponse, "hr:compensation_duplicate"],
    [HR_ERROR.PAYROLL_NOT_ENDED]: [badRequestResponse, "hr:payroll_not_ended"],
    [HR_ERROR.COMPENSATION_MISSING]: [badRequestResponse, "hr:compensation_missing"],
};

const handle = async (req: Request, res: Response, group: Group, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = MESSAGES[result] ?? [createErrorResponse, `hr:${group}_${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`hr:${group}_${action}_successfully`);
        if (action === "get") return getSuccessResponse(res, message, result);
        if (action === "create") return createSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);
const actor = (req: Request): IHrActor => ({ userId: req.user!.id, roles: req.roles ?? [] });
const me = (req: Request) => ({ id: req.user!.id, restaurant_id: req.user!.restaurant_id ?? null });
const scope = (req: Request) => req.restaurantScope;

/** Mức lương chỉ hiện cho người có quyền xem lương */
const hidePay = (req: Request, staff: IStaffMember[]) =>
    req.permissions?.includes(PayrollPermissionEnum.VIEW) ? staff : staff.map(({ pay_type, pay_amount, ...rest }) => rest);

// ---------------------------------------------------------------------------
// Của tôi (mọi nhân viên có hr.self)
// ---------------------------------------------------------------------------

export const getMyStatus = (req: Request, res: Response) => handle(req, res, "attendance", "get", () => attendanceService.getMyStatus(req.user!.id));
export const clock = (req: Request, res: Response) =>
    // 200 cho cả vào ca và ra ca (`data.action` cho biết là thao tác nào)
    handle(req, res, "clock", "update", () => attendanceService.clock(me(req), req.body.token, auditContext(req)));
export const getMyAttendance = (req: Request, res: Response) => {
    const q = myMonthSchema.shape.query.parse(req.query);
    return handle(req, res, "attendance", "get", () => attendanceService.getMyAttendance(req.user!.id, q.month));
};
export const getMyShifts = (req: Request, res: Response) => {
    const q = myRangeSchema.shape.query.parse(req.query);
    return handle(req, res, "shift", "get", () => hrService.getMyShifts(req.user!.id, q.from, q.to));
};
export const getColleagues = (req: Request, res: Response) =>
    handle(req, res, "staff", "get", () => hrService.getColleagues(req.user!.id, req.user!.restaurant_id ?? null));
export const getColleagueShifts = (req: Request, res: Response) => {
    const q = colleagueShiftsSchema.shape.query.parse(req.query);
    return handle(req, res, "shift", "get", () => hrService.getColleagueShifts(req.user!.restaurant_id ?? null, q));
};
export const getMySwaps = (req: Request, res: Response) => handle(req, res, "swap", "get", () => hrService.getMySwaps(req.user!.id));
export const createSwap = (req: Request, res: Response) => handle(req, res, "swap", "create", () => hrService.createSwap(me(req), req.body));
const respondSwap = (action: "accept" | "decline" | "cancel") => (req: Request, res: Response) =>
    handle(req, res, "swap", action, () => hrService.respondSwap(id(req), req.user!.id, action));
export const acceptSwap = respondSwap("accept");
export const declineSwap = respondSwap("decline");
export const cancelSwap = respondSwap("cancel");
export const getMyLeaves = (req: Request, res: Response) => handle(req, res, "leave", "get", () => hrService.getMyLeaves(req.user!.id));
export const createLeave = (req: Request, res: Response) => handle(req, res, "leave", "create", () => hrService.createLeave(me(req), req.body));
export const cancelLeave = (req: Request, res: Response) => handle(req, res, "leave", "cancel", () => hrService.cancelLeave(id(req), req.user!.id));
export const getMyPayslips = (req: Request, res: Response) => handle(req, res, "payroll", "get", () => payrollService.getMyPayslips(req.user!.id));

// ---------------------------------------------------------------------------
// Cấu hình, nhân viên
// ---------------------------------------------------------------------------

export const getSettings = (req: Request, res: Response) => {
    const q = hrRestaurantQuerySchema.shape.query.parse(req.query);
    return handle(req, res, "settings", "get", () => hrService.getSettings(scope(req), q.restaurant_id));
};
export const updateSettings = (req: Request, res: Response) =>
    handle(req, res, "settings", "update", () => hrService.updateSettings(req.body, scope(req), auditContext(req)));
export const rotateQr = (req: Request, res: Response) =>
    handle(req, res, "settings", "rotate", () => hrService.rotateQrSecret(scope(req), req.body.restaurant_id, auditContext(req)));
export const getStaff = (req: Request, res: Response) => {
    const q = hrStaffQuerySchema.shape.query.parse(req.query);
    return handle(req, res, "staff", "get", async () => {
        const staff = await hrService.getStaff(scope(req), q.restaurant_id, q.include_inactive ?? false);
        return typeof staff === "number" ? staff : hidePay(req, staff);
    });
};

// ---------------------------------------------------------------------------
// Ca mẫu, lịch làm việc, đổi ca
// ---------------------------------------------------------------------------

export const getTemplates = (req: Request, res: Response) => {
    const q = hrRestaurantQuerySchema.shape.query.parse(req.query);
    return handle(req, res, "template", "get", () => hrService.getTemplates(scope(req), q.restaurant_id));
};
export const createTemplate = (req: Request, res: Response) => handle(req, res, "template", "create", () => hrService.createTemplate(req.body, scope(req)));
export const updateTemplate = (req: Request, res: Response) =>
    handle(req, res, "template", "update", () => hrService.updateTemplate(id(req), req.body, scope(req)));
export const deleteTemplate = (req: Request, res: Response) => handle(req, res, "template", "delete", () => hrService.deleteTemplate(id(req), scope(req)));

export const getShifts = (req: Request, res: Response) => {
    const q = listShiftsSchema.shape.query.parse(req.query);
    return handle(req, res, "shift", "get", () => hrService.getShifts(scope(req), q));
};
export const createShifts = (req: Request, res: Response) =>
    handle(req, res, "shift", "create", () => hrService.createShifts(req.body, scope(req), actor(req)));
export const updateShift = (req: Request, res: Response) =>
    handle(req, res, "shift", "update", () => hrService.updateShift(id(req), req.body, scope(req), actor(req)));
export const deleteShift = (req: Request, res: Response) => handle(req, res, "shift", "delete", () => hrService.deleteShift(id(req), scope(req), actor(req)));
export const copyWeek = (req: Request, res: Response) => handle(req, res, "shift", "copy", () => hrService.copyWeek(req.body, scope(req), actor(req)));

export const getSwaps = (req: Request, res: Response) => {
    const q = listSwapsSchema.shape.query.parse(req.query);
    return handle(req, res, "swap", "get", () => hrService.getSwaps(scope(req), q));
};
const decideSwap = (approve: boolean) => (req: Request, res: Response) =>
    handle(req, res, "swap", approve ? "approve" : "reject", () =>
        hrService.decideSwap(id(req), approve, req.body?.note, scope(req), actor(req), auditContext(req)),
    );
export const approveSwap = decideSwap(true);
export const rejectSwap = decideSwap(false);

// ---------------------------------------------------------------------------
// Chấm công
// ---------------------------------------------------------------------------

export const getQrToken = (req: Request, res: Response) => {
    const q = hrRestaurantQuerySchema.shape.query.parse(req.query);
    return handle(req, res, "attendance", "get", () => attendanceService.getQrToken(scope(req), q.restaurant_id));
};
export const getAttendances = (req: Request, res: Response) => {
    const q = listAttendanceSchema.shape.query.parse(req.query);
    return handle(req, res, "attendance", "get", () => attendanceService.getAttendances(scope(req), q));
};
export const createAttendance = (req: Request, res: Response) =>
    handle(req, res, "attendance", "create", () => attendanceService.createManual(req.body, scope(req), actor(req), auditContext(req)));
export const updateAttendance = (req: Request, res: Response) =>
    handle(req, res, "attendance", "update", () => attendanceService.updateAttendance(id(req), req.body, scope(req), actor(req), auditContext(req)));
export const deleteAttendance = (req: Request, res: Response) =>
    handle(req, res, "attendance", "delete", () => attendanceService.deleteAttendance(id(req), scope(req), actor(req), auditContext(req)));
export const decideOvertime = (req: Request, res: Response) =>
    handle(req, res, "attendance", req.body.approve ? "approve" : "reject", () =>
        attendanceService.decideOvertime(id(req), req.body.approve, scope(req), actor(req), auditContext(req)),
    );

// ---------------------------------------------------------------------------
// Nghỉ phép
// ---------------------------------------------------------------------------

export const getLeaves = (req: Request, res: Response) => {
    const q = listLeavesSchema.shape.query.parse(req.query);
    return handle(req, res, "leave", "get", () => hrService.getLeaves(scope(req), q));
};
const decideLeave = (approve: boolean) => (req: Request, res: Response) =>
    handle(req, res, "leave", approve ? "approve" : "reject", () =>
        hrService.decideLeave(id(req), approve, req.body?.note, scope(req), actor(req), auditContext(req)),
    );
export const approveLeave = decideLeave(true);
export const rejectLeave = decideLeave(false);

// ---------------------------------------------------------------------------
// Đánh giá, hiệu suất
// ---------------------------------------------------------------------------

export const getPerformance = (req: Request, res: Response) => {
    const q = monthQuerySchema.shape.query.parse(req.query);
    return handle(req, res, "performance", "get", () => hrService.getPerformance(scope(req), q));
};
export const upsertReview = (req: Request, res: Response) =>
    handle(req, res, "review", "update", () => hrService.upsertReview(req.body, scope(req), actor(req)));

// ---------------------------------------------------------------------------
// Lương, phụ cấp, thưởng / phạt, bảng lương
// ---------------------------------------------------------------------------

export const getCompensations = (req: Request, res: Response) =>
    handle(req, res, "compensation", "get", () => payrollService.getCompensations(id(req), scope(req), actor(req)));
export const createCompensation = (req: Request, res: Response) =>
    handle(req, res, "compensation", "create", () => payrollService.createCompensation(id(req), req.body, scope(req), actor(req), auditContext(req)));
export const getAllowances = (req: Request, res: Response) =>
    handle(req, res, "allowance", "get", () => payrollService.getAllowances(id(req), scope(req), actor(req)));
export const createAllowance = (req: Request, res: Response) =>
    handle(req, res, "allowance", "create", () => payrollService.createAllowance(id(req), req.body, scope(req), actor(req), auditContext(req)));
export const updateAllowance = (req: Request, res: Response) =>
    handle(req, res, "allowance", "update", () => payrollService.updateAllowance(id(req), req.body, scope(req), actor(req), auditContext(req)));
export const deleteAllowance = (req: Request, res: Response) =>
    handle(req, res, "allowance", "delete", () => payrollService.deleteAllowance(id(req), scope(req), actor(req), auditContext(req)));

export const getAdjustments = (req: Request, res: Response) => {
    const q = listAdjustmentsSchema.shape.query.parse(req.query);
    return handle(req, res, "adjustment", "get", () => payrollService.getAdjustments(scope(req), q));
};
export const createAdjustment = (req: Request, res: Response) =>
    handle(req, res, "adjustment", "create", () => payrollService.createAdjustment(req.body, scope(req), actor(req), auditContext(req)));
export const deleteAdjustment = (req: Request, res: Response) =>
    handle(req, res, "adjustment", "delete", () => payrollService.deleteAdjustment(id(req), scope(req), actor(req), auditContext(req)));

export const getPayrolls = (req: Request, res: Response) => {
    const q = listPayrollsSchema.shape.query.parse(req.query);
    return handle(req, res, "payroll", "get", () => payrollService.getPayrolls(scope(req), q));
};
export const getPayroll = (req: Request, res: Response) => handle(req, res, "payroll", "get", () => payrollService.getPayroll(id(req), scope(req)));
export const calculatePayroll = (req: Request, res: Response) =>
    handle(req, res, "payroll", "calculate", () => payrollService.calculatePayroll(req.body, scope(req), actor(req), auditContext(req)));
export const finalizePayroll = (req: Request, res: Response) =>
    handle(req, res, "payroll", "finalize", () => payrollService.finalizePayroll(id(req), scope(req), actor(req), auditContext(req)));
