import { Router } from "express";
import { createAccount, getAccount, updateAccount, deleteAccount } from "~/controllers";

const router = Router();

router.get("/", getAccount);
router.post("/", createAccount);
router.put("/:id", updateAccount);
router.delete("/:id", deleteAccount);

export default router;
