import { Router } from "express";
import { RecipePermissionEnum } from "~/common/permission-enum";
import { recipeController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { menuCostsSchema, recipeQuerySchema, updateRecipeSchema } from "~/schemas";

/**
 * Định lượng món và giá vốn (giai đoạn 10). Định lượng dùng chung cả chuỗi (như thực đơn);
 * giá vốn tính theo giá bình quân của chi nhánh (người bị giới hạn luôn là chi nhánh của mình).
 */
const router = Router();

router.use(authMiddleware);

const VIEW = checkPermission(RecipePermissionEnum.VIEW);

// Bảng giá vốn lý thuyết của mọi món / combo
router.get("/", VIEW, validate(menuCostsSchema), restrictToRestaurant, recipeController.getMenuCosts);
router.get("/dishes/:id", VIEW, validate(recipeQuerySchema), restrictToRestaurant, recipeController.getRecipe);
router.put(
    "/dishes/:id",
    checkPermission(RecipePermissionEnum.UPDATE),
    validate(updateRecipeSchema),
    restrictToRestaurant,
    recipeController.updateRecipe,
);

export default router;
