import { Router } from "express";
import {
    EmployeePermissionEnum,
    GuestPermissionEnum,
    PermissionManagementEnum,
    UserPermissionEnum,
} from "~/common/permission-enum";
import { permissionController, userController } from "~/controllers";
import {
    authMiddleware,
    canManageTargetUser,
    checkPermission,
    restrictToRestaurant,
    uploadAvatar,
    validate,
    validateCreate,
} from "~/middlewares";
import {
    createEmployeeSchema,
    createGuestSchema,
    createUserSchema,
    createUserWithAccountSchema,
    idParamSchema,
    updateEmployeeSchema,
    updateGuestSchema,
    updateProfileSchema,
    updateUserPermissionsSchema,
} from "~/schemas";
import { z } from "zod";

const router = Router();
const idParams = validate(z.object({ params: idParamSchema }));

router.use(authMiddleware);

// ---- User chung ----
router.post(
    "/",
    checkPermission(UserPermissionEnum.CREATE),
    uploadAvatar,
    validateCreate,
    validate(createUserSchema),
    userController.createUser,
);
router.post(
    "/with-account",
    checkPermission(UserPermissionEnum.CREATE),
    uploadAvatar,
    validateCreate,
    validate(createUserWithAccountSchema),
    userController.createUserWithAccount,
);
// Hồ sơ cá nhân: của chính mình hoặc của người cấp dưới
router.patch(
    "/:id",
    checkPermission(UserPermissionEnum.UPDATE),
    uploadAvatar,
    validate(updateProfileSchema),
    canManageTargetUser({ allowSelf: true }),
    userController.updateUser,
);
router.patch(
    "/delete/:id",
    checkPermission(UserPermissionEnum.DELETE),
    idParams,
    canManageTargetUser(),
    userController.deleteUser,
);

// ---- Quyền cấp trực tiếp cho user ----
router.get(
    "/:id/permissions",
    checkPermission(PermissionManagementEnum.VIEW),
    idParams,
    canManageTargetUser({ allowSelf: true }),
    permissionController.getUserPermissions,
);
router.put(
    "/:id/permissions",
    checkPermission(PermissionManagementEnum.ASSIGN),
    validate(updateUserPermissionsSchema),
    canManageTargetUser(),
    permissionController.updateUserPermissions,
);

// ---- Nhân viên ----
router.get(
    "/employees",
    checkPermission(EmployeePermissionEnum.VIEW),
    restrictToRestaurant,
    userController.getEmployees,
);
router.post(
    "/employee",
    checkPermission(EmployeePermissionEnum.CREATE),
    uploadAvatar, // multipart: req.body chỉ có sau multer
    validate(createEmployeeSchema),
    restrictToRestaurant,
    userController.createEmployee,
);
router.patch(
    "/employee/:id",
    checkPermission(EmployeePermissionEnum.UPDATE),
    uploadAvatar,
    validate(updateEmployeeSchema),
    restrictToRestaurant,
    canManageTargetUser({ targetKind: "employee" }),
    userController.updateEmployee,
);
router.patch(
    "/employee/delete/:id",
    checkPermission(EmployeePermissionEnum.DELETE),
    idParams,
    canManageTargetUser({ targetKind: "employee" }),
    userController.deleteEmployee,
);

// ---- Khách hàng ----
router.get("/guests", checkPermission(GuestPermissionEnum.VIEW), userController.getGuests);
router.post(
    "/guest",
    checkPermission(GuestPermissionEnum.CREATE),
    uploadAvatar,
    validate(createGuestSchema),
    userController.createGuest,
);
router.patch(
    "/guest/:id",
    checkPermission(GuestPermissionEnum.UPDATE),
    uploadAvatar,
    validate(updateGuestSchema),
    canManageTargetUser({ targetKind: "guest" }),
    userController.updateGuest,
);
router.patch(
    "/guest/delete/:id",
    checkPermission(GuestPermissionEnum.DELETE),
    idParams,
    canManageTargetUser({ targetKind: "guest" }),
    userController.deleteGuest,
);

export default router;
