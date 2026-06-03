import { Router } from "express";
import { tableController } from "~/controllers";

const router = Router();

router.get("/all", tableController.getAllTables);
router.get("/", tableController.getTables);

export default router;
