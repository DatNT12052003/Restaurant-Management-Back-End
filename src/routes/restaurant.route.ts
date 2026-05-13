import { Router } from "express";
import { restaurantController } from "~/controllers";

const router = Router();

router.get("/", restaurantController.getRestaurants);

export default router;
