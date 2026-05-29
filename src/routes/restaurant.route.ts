import { Router } from "express";
import { restaurantController } from "~/controllers";

const router = Router();

router.get("/", restaurantController.getRestaurants);
router.get("/all", restaurantController.getAllRestaurants);

export default router;
