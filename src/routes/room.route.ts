import { Router } from "express";
import { roomController } from "~/controllers";

const router = Router();

router.get("/all", roomController.getAllRooms);

export default router;
