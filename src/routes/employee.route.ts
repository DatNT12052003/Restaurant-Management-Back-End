import { Router } from "express";
import { employeeController } from "~/controllers";
import { validateCreate } from "~/middlewares";

const router = Router();

router.post("/", validateCreate, employeeController.createEmployee);
router.post("/with-account", validateCreate, employeeController.createEmployeeWithAccount);

export default router;
