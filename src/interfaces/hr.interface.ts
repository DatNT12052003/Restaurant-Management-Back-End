import {
    AdjustmentTypeEnum,
    LeaveStatusEnum,
    LeaveTypeEnum,
    OvertimeStatusEnum,
    PayrollStatusEnum,
    PayTypeEnum,
    ShiftSwapStatusEnum,
} from "~/common/enum";

/** Giai đoạn 12: nhân sự. pg trả numeric dưới dạng chuỗi. */
type Numeric = string | number;

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
export type HrScope = number | null | undefined;

/** Người thao tác (để kiểm tra cấp bậc và không tự duyệt cho mình) */
export interface IHrActor {
    userId: number;
    roles: string[];
}

export interface IHrSettings {
    restaurant_id: number;
    standard_work_days: number;
    standard_hours_per_day: Numeric;
    late_grace_minutes: number;
    early_leave_grace_minutes: number;
    late_penalty_amount: Numeric;
    overtime_threshold_minutes: number;
    overtime_multiplier: Numeric;
    early_clock_in_minutes: number;
}

export interface IHrSettingsRow extends IHrSettings {
    qr_secret: string;
}

export type IHrSettingsBody = Partial<Omit<IHrSettings, "restaurant_id">>;

/** Nhân viên của chi nhánh (dùng cho xếp ca, chấm công, lương) */
export interface IStaffMember {
    id: number;
    full_name: string;
    avatar_url: string | null;
    status: string;
    restaurant_id: number;
    roles: string[];
    pay_type?: PayTypeEnum | null;
    pay_amount?: Numeric | null;
}

export interface IShiftTemplate {
    id: number;
    restaurant_id: number;
    name: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    status: "active" | "inactive";
    created_at: Date;
    updated_at: Date;
}

export interface IShiftTemplateBody {
    restaurant_id?: number;
    name?: string;
    start_time?: string;
    end_time?: string;
    break_minutes?: number;
    status?: "active" | "inactive";
}

export interface IShiftAssignment {
    id: number;
    restaurant_id: number;
    user_id: number;
    full_name?: string;
    shift_template_id: number | null;
    template_name?: string | null;
    work_date: string;
    start_at: Date;
    end_at: Date;
    break_minutes: number;
    note: string | null;
    created_by: number | null;
    /** Lượt chấm công của ca (nếu có) */
    attendance_id?: number | null;
    /** Nghỉ phép đã duyệt trùng ngày (chỉ khi xem lịch) */
    on_leave?: boolean;
}

export interface ICreateShiftsBody {
    restaurant_id?: number;
    user_ids: number[];
    dates: string[];
    shift_template_id?: number | null;
    start_time?: string;
    end_time?: string;
    break_minutes?: number;
    note?: string | null;
}

export interface IUpdateShiftBody {
    user_id?: number;
    work_date?: string;
    start_time?: string;
    end_time?: string;
    break_minutes?: number;
    shift_template_id?: number | null;
    note?: string | null;
}

export interface IShiftSwap {
    id: number;
    restaurant_id: number;
    assignment_id: number;
    requester_id: number;
    requester_name?: string;
    target_user_id: number;
    target_name?: string;
    target_assignment_id: number | null;
    status: ShiftSwapStatusEnum;
    reason: string | null;
    target_responded_at: Date | null;
    decided_by: number | null;
    decided_by_name?: string | null;
    decided_at: Date | null;
    decision_note: string | null;
    created_at: Date;
    /** Thông tin hai ca để hiển thị */
    shift?: { work_date: string; start_at: Date; end_at: Date } | null;
    target_shift?: { work_date: string; start_at: Date; end_at: Date } | null;
}

export interface IAttendance {
    id: number;
    restaurant_id: number;
    user_id: number;
    full_name?: string;
    assignment_id: number | null;
    work_date: string;
    clock_in_at: Date;
    clock_out_at: Date | null;
    method: "qr" | "manual";
    late_minutes: number;
    early_leave_minutes: number;
    worked_minutes: number;
    overtime_minutes: number;
    overtime_status: OvertimeStatusEnum;
    overtime_decided_by: number | null;
    note: string | null;
    created_by: number | null;
    shift_start_at?: Date | null;
    shift_end_at?: Date | null;
}

export interface IManualAttendanceBody {
    restaurant_id?: number;
    user_id: number;
    assignment_id?: number | null;
    clock_in_at: string;
    clock_out_at?: string | null;
    note?: string | null;
}

export interface IUpdateAttendanceBody {
    clock_in_at?: string;
    clock_out_at?: string | null;
    note?: string | null;
}

export interface IClockResult {
    action: "clock_in" | "clock_out";
    attendance: IAttendance;
}

export interface IMyHrStatus {
    open_attendance: IAttendance | null;
    next_shift: IShiftAssignment | null;
}

export interface ILeaveRequest {
    id: number;
    restaurant_id: number;
    user_id: number;
    full_name?: string;
    start_date: string;
    end_date: string;
    days: number;
    type: LeaveTypeEnum;
    reason: string | null;
    status: LeaveStatusEnum;
    decided_by: number | null;
    decided_by_name?: string | null;
    decided_at: Date | null;
    decision_note: string | null;
    created_at: Date;
}

export interface ICompensation {
    id: number;
    user_id: number;
    pay_type: PayTypeEnum;
    amount: Numeric;
    effective_from: string;
    note: string | null;
    created_by: number | null;
    created_by_name?: string | null;
    created_at: Date;
}

export interface ICompensationBody {
    pay_type: PayTypeEnum;
    amount: number;
    effective_from: string;
    note?: string | null;
}

export interface IAllowance {
    id: number;
    user_id: number;
    name: string;
    amount: Numeric;
    status: "active" | "inactive";
    created_at: Date;
    updated_at: Date;
}

export interface IAllowanceBody {
    name?: string;
    amount?: number;
    status?: "active" | "inactive";
}

export interface IAdjustment {
    id: number;
    restaurant_id: number;
    user_id: number;
    full_name?: string;
    type: AdjustmentTypeEnum;
    amount: Numeric;
    reason: string;
    effective_date: string;
    source: "manual" | "late";
    attendance_id: number | null;
    payroll_id: number | null;
    created_by: number | null;
    created_by_name?: string | null;
    created_at: Date;
}

export interface IAdjustmentBody {
    restaurant_id?: number;
    user_id: number;
    type: AdjustmentTypeEnum;
    amount: number;
    reason: string;
    effective_date: string;
}

export interface IPayrollItem {
    id: number;
    payroll_id: number;
    user_id: number;
    full_name: string;
    pay_type: PayTypeEnum | null;
    rate: Numeric | null;
    work_days: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    worked_minutes: number;
    overtime_minutes: number;
    late_count: number;
    base_pay: Numeric;
    overtime_pay: Numeric;
    allowance_total: Numeric;
    bonus_total: Numeric;
    penalty_total: Numeric;
    tip_total: Numeric;
    net_pay: Numeric;
    details: IPayrollItemDetails;
}

export interface IPayrollItemDetails {
    rates: { pay_type: PayTypeEnum; amount: number; days: number; minutes: number; base_pay: number }[];
    allowances: { name: string; amount: number }[];
    adjustments: { id: number; type: AdjustmentTypeEnum; amount: number; reason: string; effective_date: string }[];
    missing_rate_days: number;
    /** Phút tăng ca chưa duyệt (không tính lương) */
    pending_overtime_minutes: number;
}

export interface IPayroll {
    id: number;
    restaurant_id: number;
    restaurant_name?: string;
    period_month: string;
    status: PayrollStatusEnum;
    total_net: Numeric;
    labor_cost: Numeric;
    employee_count: number;
    note: string | null;
    created_by: number | null;
    calculated_at: Date;
    finalized_by: number | null;
    finalized_by_name?: string | null;
    finalized_at: Date | null;
    items?: IPayrollItem[];
}

export interface IStaffReview {
    id: number;
    restaurant_id: number;
    user_id: number;
    period_month: string;
    rating: number;
    comment: string | null;
    reviewer_id: number | null;
    reviewer_name?: string | null;
    updated_at: Date;
}

export interface IStaffPerformance {
    user_id: number;
    full_name: string;
    roles: string[];
    scheduled_shifts: number;
    work_days: number;
    worked_minutes: number;
    overtime_minutes: number;
    late_count: number;
    late_minutes: number;
    early_leave_count: number;
    /** Ca đã xếp đã qua nhưng không chấm công */
    absent_shifts: number;
    leave_days: number;
    orders_served: number;
    tip_total: Numeric;
    bonus_total: Numeric;
    penalty_total: Numeric;
    review: IStaffReview | null;
}
