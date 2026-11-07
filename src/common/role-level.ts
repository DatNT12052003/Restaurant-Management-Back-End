import { RolesEnum } from "./enum";

/**
 * Cấp bậc vai trò, dùng để chống leo thang quyền:
 * - Chỉ được gán vai trò có cấp THẤP HƠN cấp cao nhất của mình.
 * - Chỉ được quản lý (sửa/xóa/phân quyền) người có cấp cao nhất THẤP HƠN mình.
 * Admin không bị giới hạn.
 */
const ROLE_LEVEL: Record<string, number> = {
    [RolesEnum.ADMIN]: 100,
    [RolesEnum.MANAGER]: 80,
    [RolesEnum.SUPERVISOR]: 60,
    [RolesEnum.GUEST]: 10,
};

/** Các vai trò nghiệp vụ còn lại (thu ngân, lễ tân, phục vụ, bếp, ...) */
const DEFAULT_STAFF_LEVEL = 40;

export const getRoleLevel = (role: string): number => ROLE_LEVEL[role] ?? DEFAULT_STAFF_LEVEL;

export const maxRoleLevel = (roles: string[]): number =>
    roles.length === 0 ? 0 : Math.max(...roles.map(getRoleLevel));

export const isAdmin = (roles: string[] | undefined): boolean => !!roles?.includes(RolesEnum.ADMIN);

export const canAssignRole = (actorRoles: string[], role: string): boolean =>
    isAdmin(actorRoles) || getRoleLevel(role) < maxRoleLevel(actorRoles);

export const outranks = (actorRoles: string[], targetRoles: string[]): boolean =>
    isAdmin(actorRoles) || maxRoleLevel(actorRoles) > maxRoleLevel(targetRoles);
