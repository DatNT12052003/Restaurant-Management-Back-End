import { Router } from "express";
import { roomController } from "~/controllers";

const router = Router();

router.get("/all", roomController.getAllRooms);
router.get("/", roomController.getRooms);

export default router;
