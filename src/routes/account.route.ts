import { Router } from "express";
import { accountController } from "~/controllers";
import { validateCreate } from "~/middlewares";

const router = Router();

router.get("/", accountController.getAccounts);
router.post("/", validateCreate, accountController.createAccount);
router.put("/:id", accountController.updateAccount);
router.delete("/:id", accountController.deleteAccount);

export default router;
