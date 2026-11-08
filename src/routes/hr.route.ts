import { Router } from "express";
import {
    AttendancePermissionEnum,
    HrPermissionEnum,
    LeavePermissionEnum,
    PayrollPermissionEnum,
    ShiftPermissionEnum,
    StaffReviewPermissionEnum,
} from "~/common/permission-enum";
import { hrController as c } from "~/controllers";
import { auditRoute, authMiddleware, checkAnyPermission, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import {
    calculatePayrollSchema,
    clockSchema,
    colleagueShiftsSchema,
    copyWeekSchema,
    createAdjustmentSchema,
    createAllowanceSchema,
    createAttendanceSchema,
    createCompensationSchema,
    createLeaveSchema,
    createShiftsSchema,
    createShiftTemplateSchema,
    createSwapSchema,
    decisionSchema,
    hrIdSchema,
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
    overtimeDecisionSchema,
    rotateQrSchema,
    updateAllowanceSchema,
    updateAttendanceSchema,
    updateHrSettingsSchema,
    updateShiftSchema,
    updateShiftTemplateSchema,
    upsertReviewSchema,
} from "~/schemas";

/**
 * Giai đoạn 12: nhân sự, mount tại `/api/hr`.
 * - `/me/*`: mọi nhân viên có `hr.self` (lịch của mình, chấm công QR, đổi ca, nghỉ phép, phiếu lương). Luôn theo chi nhánh của mình.
 * - Còn lại: theo quyền của từng phần, giới hạn chi nhánh bằng `restrictToRestaurant`; service kiểm tra cấp bậc với nhân viên bị thao tác.
 */
const router = Router();
router.use(authMiddleware);

const SELF = checkPermission(HrPermissionEnum.SELF);
const SHIFT_VIEW = checkPermission(ShiftPermissionEnum.VIEW);
const SHIFT_MANAGE = checkPermission(ShiftPermissionEnum.MANAGE);
const ATT_VIEW = checkPermission(AttendancePermissionEnum.VIEW);
const ATT_MANAGE = checkPermission(AttendancePermissionEnum.MANAGE);
const PAY_VIEW = checkPermission(PayrollPermissionEnum.VIEW);
const PAY_MANAGE = checkPermission(PayrollPermissionEnum.MANAGE);
/** Người làm việc với nhân sự của chi nhánh ở bất kỳ phần nào */
const ANY_HR = checkAnyPermission([
    ShiftPermissionEnum.VIEW,
    AttendancePermissionEnum.VIEW,
    LeavePermissionEnum.APPROVE,
    StaffReviewPermissionEnum.MANAGE,
    PayrollPermissionEnum.VIEW,
]);
const scoped = restrictToRestaurant;

// ---- Của tôi ----
router.get("/me/status", SELF, c.getMyStatus);
router.post("/me/clock", SELF, validate(clockSchema), c.clock);
router.get("/me/attendance", SELF, validate(myMonthSchema), c.getMyAttendance);
router.get("/me/shifts", SELF, validate(myRangeSchema), c.getMyShifts);
router.get("/me/colleagues", SELF, c.getColleagues);
router.get("/me/colleague-shifts", SELF, validate(colleagueShiftsSchema), c.getColleagueShifts);
router.get("/me/swaps", SELF, c.getMySwaps);
router.post("/me/swaps", SELF, validate(createSwapSchema), c.createSwap);
router.post("/me/swaps/:id/accept", SELF, validate(hrIdSchema), c.acceptSwap);
router.post("/me/swaps/:id/decline", SELF, validate(hrIdSchema), c.declineSwap);
router.post("/me/swaps/:id/cancel", SELF, validate(hrIdSchema), c.cancelSwap);
router.get("/me/leaves", SELF, c.getMyLeaves);
router.post("/me/leaves", SELF, validate(createLeaveSchema), c.createLeave);
router.post("/me/leaves/:id/cancel", SELF, validate(hrIdSchema), c.cancelLeave);
router.get("/me/payslips", SELF, c.getMyPayslips);

// ---- Cấu hình, nhân viên ----
router.get("/settings", ANY_HR, validate(hrRestaurantQuerySchema), scoped, c.getSettings);
router.patch("/settings", PAY_MANAGE, validate(updateHrSettingsSchema), scoped, c.updateSettings);
router.post(
    "/settings/rotate-qr",
    checkAnyPermission([AttendancePermissionEnum.MANAGE, PayrollPermissionEnum.MANAGE]),
    validate(rotateQrSchema),
    scoped,
    c.rotateQr,
);
router.get("/staff", ANY_HR, validate(hrStaffQuerySchema), scoped, c.getStaff);

// ---- Ca mẫu ----
router.get("/shift-templates", SHIFT_VIEW, validate(hrRestaurantQuerySchema), scoped, c.getTemplates);
router.post("/shift-templates", SHIFT_MANAGE, validate(createShiftTemplateSchema), scoped, auditRoute("shift_template.create", "shift_template"), c.createTemplate);
router.patch("/shift-templates/:id", SHIFT_MANAGE, validate(updateShiftTemplateSchema), scoped, auditRoute("shift_template.update", "shift_template"), c.updateTemplate);
router.delete("/shift-templates/:id", SHIFT_MANAGE, validate(hrIdSchema), scoped, auditRoute("shift_template.delete", "shift_template"), c.deleteTemplate);

// ---- Lịch làm việc ----
router.get("/shifts", SHIFT_VIEW, validate(listShiftsSchema), scoped, c.getShifts);
router.post("/shifts", SHIFT_MANAGE, validate(createShiftsSchema), scoped, auditRoute("shift.create", "shift"), c.createShifts);
router.post("/shifts/copy-week", SHIFT_MANAGE, validate(copyWeekSchema), scoped, auditRoute("shift.copy_week", "shift"), c.copyWeek);
router.patch("/shifts/:id", SHIFT_MANAGE, validate(updateShiftSchema), scoped, auditRoute("shift.update", "shift"), c.updateShift);
router.delete("/shifts/:id", SHIFT_MANAGE, validate(hrIdSchema), scoped, auditRoute("shift.delete", "shift"), c.deleteShift);

// ---- Đổi ca (quản lý duyệt) ----
router.get("/shift-swaps", SHIFT_MANAGE, validate(listSwapsSchema), scoped, c.getSwaps);
router.post("/shift-swaps/:id/approve", SHIFT_MANAGE, validate(decisionSchema), scoped, c.approveSwap);
router.post("/shift-swaps/:id/reject", SHIFT_MANAGE, validate(decisionSchema), scoped, c.rejectSwap);

// ---- Chấm công ----
router.get("/attendance/qr", checkPermission(AttendancePermissionEnum.KIOSK), validate(hrRestaurantQuerySchema), scoped, c.getQrToken);
router.get("/attendance", ATT_VIEW, validate(listAttendanceSchema), scoped, c.getAttendances);
router.post("/attendance", ATT_MANAGE, validate(createAttendanceSchema), scoped, c.createAttendance);
router.patch("/attendance/:id", ATT_MANAGE, validate(updateAttendanceSchema), scoped, c.updateAttendance);
router.delete("/attendance/:id", ATT_MANAGE, validate(hrIdSchema), scoped, c.deleteAttendance);
router.post("/attendance/:id/overtime", ATT_MANAGE, validate(overtimeDecisionSchema), scoped, c.decideOvertime);

// ---- Nghỉ phép ----
const LEAVE_APPROVE = checkPermission(LeavePermissionEnum.APPROVE);
router.get("/leaves", LEAVE_APPROVE, validate(listLeavesSchema), scoped, c.getLeaves);
router.post("/leaves/:id/approve", LEAVE_APPROVE, validate(decisionSchema), scoped, c.approveLeave);
router.post("/leaves/:id/reject", LEAVE_APPROVE, validate(decisionSchema), scoped, c.rejectLeave);

// ---- Đánh giá, hiệu suất ----
router.get(
    "/performance",
    checkAnyPermission([StaffReviewPermissionEnum.MANAGE, PayrollPermissionEnum.VIEW]),
    validate(monthQuerySchema),
    scoped,
    c.getPerformance,
);
router.put(
    "/reviews",
    checkPermission(StaffReviewPermissionEnum.MANAGE),
    validate(upsertReviewSchema),
    scoped,
    auditRoute("staff_review.update", "staff_review"),
    c.upsertReview,
);

// ---- Lương, phụ cấp ----
router.get("/employees/:id/compensations", PAY_VIEW, validate(hrIdSchema), scoped, c.getCompensations);
router.post("/employees/:id/compensations", PAY_MANAGE, validate(createCompensationSchema), scoped, c.createCompensation);
router.get("/employees/:id/allowances", PAY_VIEW, validate(hrIdSchema), scoped, c.getAllowances);
router.post("/employees/:id/allowances", PAY_MANAGE, validate(createAllowanceSchema), scoped, c.createAllowance);
router.patch("/allowances/:id", PAY_MANAGE, validate(updateAllowanceSchema), scoped, c.updateAllowance);
router.delete("/allowances/:id", PAY_MANAGE, validate(hrIdSchema), scoped, c.deleteAllowance);

// ---- Thưởng / phạt ----
router.get("/adjustments", PAY_VIEW, validate(listAdjustmentsSchema), scoped, c.getAdjustments);
router.post("/adjustments", PAY_MANAGE, validate(createAdjustmentSchema), scoped, c.createAdjustment);
router.delete("/adjustments/:id", PAY_MANAGE, validate(hrIdSchema), scoped, c.deleteAdjustment);

// ---- Bảng lương ----
router.get("/payrolls", PAY_VIEW, validate(listPayrollsSchema), scoped, c.getPayrolls);
router.post("/payrolls/calculate", PAY_MANAGE, validate(calculatePayrollSchema), scoped, c.calculatePayroll);
router.get("/payrolls/:id", PAY_VIEW, validate(hrIdSchema), scoped, c.getPayroll);
router.post("/payrolls/:id/finalize", PAY_MANAGE, validate(hrIdSchema), scoped, c.finalizePayroll);

export default router;
