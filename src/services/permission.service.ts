import { RolesEnum } from "~/common/enum";
import { PERMISSION_ERROR } from "~/common/error-code/permission";
import { canAssignRole, isAdmin } from "~/common/role-level";
import { withTransaction } from "~/config/db";
import { IAuditContext, IPermission, IRoleWithPermissions } from "~/interfaces";
import { permissionRepository, roleRepository, userRepository } from "~/repositories";
import { AUDIT_ACTION, writeAudit } from "~/utils/audit";

interface IActor {
    roles: string[];
    permissions: string[];
    audit?: IAuditContext;
}

/** Ghi nhật ký thay đổi quyền (đặc tả 6.1), trong transaction của thao tác. Không có thay đổi thì không ghi. */
const auditPermissionChange = async (
    actor: IActor,
    entry: { action: string; entity_type: string; entity_id: number; restaurant_id: number | null },
    current: string[],
    next: string[],
) => {
    const unique = [...new Set(next)].sort();
    const added = unique.filter((p) => !current.includes(p));
    const removed = current.filter((p) => !unique.includes(p));
    if (!added.length && !removed.length) return;
    await writeAudit(actor.audit ?? {}, {
        ...entry,
        before: { permissions: [...current].sort() },
        after: { permissions: unique, added, removed },
    });
};

/**
 * So sánh tập quyền hiện tại với tập quyền mới. Người thao tác chỉ được thêm/gỡ những quyền mà chính mình đang có
 * (admin không bị giới hạn). Trả về id quyền cần thêm / gỡ, hoặc mã lỗi.
 */
const diffPermissions = async (
    current: string[],
    next: string[],
    actor: IActor,
): Promise<{ addIds: number[]; removeIds: number[] } | number> => {
    const unique = [...new Set(next)];
    const nextEntities = unique.length ? await permissionRepository.getPermissionsByTypeNames(unique) : [];
    if (nextEntities.length !== unique.length) {
        return PERMISSION_ERROR.INVALID_PERMISSIONS;
    }

    const added = unique.filter((p) => !current.includes(p));
    const removed = current.filter((p) => !unique.includes(p));
    if (!isAdmin(actor.roles) && [...added, ...removed].some((p) => !actor.permissions.includes(p))) {
        return PERMISSION_ERROR.PERMISSION_NOT_GRANTABLE;
    }

    const removedEntities = removed.length ? await permissionRepository.getPermissionsByTypeNames(removed) : [];
    return {
        addIds: nextEntities.filter((p) => added.includes(p.type_name)).map((p) => p.id),
        removeIds: removedEntities.map((p) => p.id),
    };
};

export const getPermissions = async (): Promise<IPermission[] | number> => {
    try {
        return await permissionRepository.getAllPermissions();
    } catch (error) {
        return PERMISSION_ERROR.FAILED;
    }
};

/** `editable`: người hiện tại có được sửa quyền của role này không. */
export const getRoles = async (actor: IActor): Promise<IRoleWithPermissions[] | number> => {
    try {
        const roles = await roleRepository.getRolesWithPermissions();
        return roles.map((role) => ({
            id: role.id,
            name: role.name,
            type_name: role.type_name,
            permissions: role.permissions,
            user_count: role.user_count,
            editable: role.type_name !== RolesEnum.ADMIN && canAssignRole(actor.roles, role.type_name),
        }));
    } catch (error) {
        return PERMISSION_ERROR.FAILED;
    }
};

export const updateRolePermissions = async (
    roleId: number,
    permissions: string[],
    actor: IActor,
): Promise<{ role_id: number; permissions: string[] } | number> => {
    try {
        const role = await roleRepository.getRoleById(roleId);
        if (!role) return PERMISSION_ERROR.ROLE_NOT_FOUND;
        // Admin luôn giữ toàn quyền; không cho sửa để tránh tự khóa hệ thống
        if (role.type_name === RolesEnum.ADMIN) return PERMISSION_ERROR.ADMIN_ROLE_LOCKED;
        if (!canAssignRole(actor.roles, role.type_name)) return PERMISSION_ERROR.ROLE_NOT_MANAGEABLE;

        return await withTransaction(async () => {
            const current = await permissionRepository.getPermissionsByRoleId(roleId);
            const diff = await diffPermissions(current, permissions, actor);
            if (typeof diff === "number") return diff;

            await permissionRepository.addRolePermissions(roleId, diff.addIds);
            await permissionRepository.removeRolePermissions(roleId, diff.removeIds);
            // Vai trò áp dụng cho cả chuỗi -> không gắn nhà hàng
            await auditPermissionChange(
                actor,
                { action: AUDIT_ACTION.ROLE_PERMISSIONS, entity_type: "role", entity_id: roleId, restaurant_id: null },
                current,
                permissions,
            );
            return { role_id: roleId, permissions: [...new Set(permissions)].sort() };
        });
    } catch (error) {
        return PERMISSION_ERROR.FAILED;
    }
};

export const getUserPermissions = async (
    userId: number,
): Promise<{ role_permissions: string[]; direct_permissions: string[] } | number> => {
    try {
        const [rolePermissions, directPermissions] = await Promise.all([
            permissionRepository.getRolePermissionsByUserId(userId),
            permissionRepository.getDirectPermissionsByUserId(userId),
        ]);
        return { role_permissions: rolePermissions.sort(), direct_permissions: directPermissions.sort() };
    } catch (error) {
        return PERMISSION_ERROR.FAILED;
    }
};

/** Thay thế toàn bộ quyền cấp trực tiếp của user (không ảnh hưởng quyền nhận qua role). */
export const updateUserPermissions = async (
    userId: number,
    permissions: string[],
    actor: IActor,
): Promise<{ user_id: number; direct_permissions: string[] } | number> => {
    try {
        return await withTransaction(async () => {
            const current = await permissionRepository.getDirectPermissionsByUserId(userId);
            const diff = await diffPermissions(current, permissions, actor);
            if (typeof diff === "number") return diff;

            await permissionRepository.addUserPermissions(userId, diff.addIds);
            await permissionRepository.removeUserPermissions(userId, diff.removeIds);
            const target = await userRepository.getUserById(userId);
            await auditPermissionChange(
                actor,
                {
                    action: AUDIT_ACTION.USER_PERMISSIONS,
                    entity_type: "user",
                    entity_id: userId,
                    restaurant_id: target?.restaurant_id ?? null,
                },
                current,
                permissions,
            );
            return { user_id: userId, direct_permissions: [...new Set(permissions)].sort() };
        });
    } catch (error) {
        return PERMISSION_ERROR.FAILED;
    }
};
