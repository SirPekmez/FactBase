import { Router } from "express";
import { logout } from "../controllers/authController";

const router = Router();

router.post("/logout", logout);

export default router;