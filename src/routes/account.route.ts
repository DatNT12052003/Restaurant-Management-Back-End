import { Router } from "express";
import { accountController } from "~/controllers";
import { validate, validateCreate } from "~/middlewares";
import { createAccountSchema } from "~/schemas";

const router = Router();

router.get("/", accountController.getAccounts);
router.post("/", validateCreate, validate(createAccountSchema), accountController.createAccount);
router.put("/:id", accountController.updateAccount);
router.delete("/:id", accountController.deleteAccount);

export default router;
