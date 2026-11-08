import { isAdmin, outranks } from "~/common/role-level";
import { HR_ERROR } from "~/common/error-code/hr";
import { HrScope, IHrActor, IStaffMember } from "~/interfaces";
import { hrRepository, restaurantRepository } from "~/repositories";
import { monthRange } from "~/utils/hr-time";

/**
 * Kiểm tra dùng chung cho phân hệ nhân sự (giai đoạn 12).
 * Không đặt trong `services/index.ts`: chỉ các service nhân sự dùng.
 */

/** Chi nhánh thao tác: người bị giới hạn luôn là chi nhánh của mình; admin phải chỉ định */
export const resolveRestaurant = async (scope: HrScope, requested?: number | null): Promise<{ id: number } | number> => {
    const id = scope ?? requested;
    if (!id) return HR_ERROR.RESTAURANT_REQUIRED;
    if (!(await restaurantRepository.getRestaurantById(id))) return HR_ERROR.RESTAURANT_NOT_FOUND;
    return { id };
};

export const inScope = (restaurantId: number, scope: HrScope) => scope === null || scope === undefined || restaurantId === scope;

/**
 * Nhân viên bị thao tác: phải là nhân viên (không phải khách) của chi nhánh `restaurantId` (nếu có),
 * và người thao tác phải có cấp cao hơn (admin luôn được). `allowSelf`: cho phép thao tác trên chính mình.
 */
export const checkTarget = async (
    userId: number,
    restaurantId: number | null,
    actor: IHrActor,
    options: { allowSelf?: boolean } = {},
): Promise<IStaffMember | number> => {
    const staff = await hrRepository.getStaffMember(userId);
    if (!staff || (restaurantId !== null && staff.restaurant_id !== restaurantId)) return HR_ERROR.STAFF_NOT_FOUND;
    if (isAdmin(actor.roles)) return staff;
    if (staff.id === actor.userId) return options.allowSelf ? staff : HR_ERROR.CANNOT_MANAGE;
    if (!outranks(actor.roles, staff.roles)) return HR_ERROR.CANNOT_MANAGE;
    return staff;
};

/** Ngày thuộc tháng đã có bảng lương chốt ở chi nhánh: không được thay đổi số liệu chấm công / thưởng phạt / nghỉ phép */
export const isPayrollLocked = async (restaurantId: number, date: string): Promise<boolean> => {
    const payroll = await hrRepository.getPayrollByMonth(restaurantId, monthRange(date).start);
    return payroll?.status === "finalized";
};

/** Mã lỗi của Postgres khi vi phạm ràng buộc EXCLUDE (ca chồng lấn) và UNIQUE */
export const PG_EXCLUSION = "23P01";
export const PG_UNIQUE = "23505";
export const pgCode = (error: unknown): string | undefined => (error as { code?: string })?.code;
