import { Request } from "express";
import {
    accountRepository,
    discountRepository,
    inventoryRepository,
    menuRepository,
    paymentRepository,
    reservationRepository,
    restaurantRepository,
    roleRepository,
    roomRepository,
    tableRepository,
    userRepository,
} from "~/repositories";
import { getAccountResource, getUserResource } from "~/resources";
import type { IAuditRouteOptions } from "~/middlewares/audit.middleware";

/**
 * Đọc bản ghi trước khi thay đổi cho `auditRoute` (đặc tả 4.11: dữ liệu trước và sau khi thay đổi).
 * Dạng trả về khớp với `data` trong response của route tương ứng, để chỉ ghi các trường thay đổi.
 */
const byId =
    <T>(load: (id: number) => Promise<T>) =>
    (req: Request) =>
        load(Number(req.params.id));

/** Hồ sơ user dạng `getUserResource` */
const userProfile = async (req: Request) => {
    const user = await userRepository.getUserById(Number(req.params.id));
    return user ? getUserResource(user) : undefined;
};

/** Nhân viên / khách dạng `{ user, account, roles? }` như response tạo / sửa */
const userWithAccount = (withRoles: boolean) => async (req: Request) => {
    const user = await userRepository.getUserById(Number(req.params.id));
    if (!user) return undefined;
    const account = user.account_id ? await accountRepository.getAccountById(user.account_id) : undefined;
    return {
        user: getUserResource(user),
        ...(account ? { account: getAccountResource(account) } : {}),
        ...(withRoles ? { roles: await roleRepository.getRolesByUserId(user.id) } : {}),
    };
};

export const AUDIT_BEFORE = {
    restaurant: byId(restaurantRepository.getRestaurantById),
    room: byId((id) => roomRepository.getRoomById(id)),
    table: byId(tableRepository.getTableById),
    dish: byId(menuRepository.getDishById),
    combo: byId(menuRepository.getComboById),
    discount: byId((id) => discountRepository.getDiscountById(id)),
    reservation: byId((id) => reservationRepository.getReservationById(id)),
    ingredient: byId((id) => inventoryRepository.getIngredientById(id)),
    payment: byId((id) => paymentRepository.getPaymentById(id)),
    account: async (req: Request) => {
        const account = await accountRepository.getAccountById(Number(req.params.id));
        return account ? getAccountResource(account) : undefined;
    },
    user: userProfile,
    employee: userWithAccount(true),
    guest: userWithAccount(false),
};

/** Response tạo / sửa nhân viên, khách có dạng `{ user, account, roles? }`: lấy id và nhà hàng từ `user` */
export const NESTED_USER: Pick<IAuditRouteOptions, "entityId" | "restaurantId"> = {
    entityId: (req, data) => req.params?.id ?? data?.user?.id,
    restaurantId: (_req, data, before) => data?.user?.restaurant_id ?? before?.user?.restaurant_id,
};
