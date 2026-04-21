import { Router } from "express";
import { employeeController } from "~/controllers";
import { uploadAvatar, validate, validateCreate } from "~/middlewares";
import { createEmployeeSchema, createEmployeeWithAccountSchema } from "~/schemas";

const router = Router();

router.post("/", uploadAvatar, validateCreate, validate(createEmployeeSchema), employeeController.createEmployee);
router.post(
    "/with-account",
    uploadAvatar,
    validateCreate,
    validate(createEmployeeWithAccountSchema),
    employeeController.createEmployeeWithAccount,
);

export default router;
