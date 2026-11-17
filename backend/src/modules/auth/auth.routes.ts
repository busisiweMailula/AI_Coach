import { Router } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { validateBody } from "../../middleware/validate.js";
import { login, loginSchema, registerCandidate, registerSchema } from "./auth.service.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const user = await registerCandidate(req.body);
    res.status(201).json({ success: true, data: { user } });
  }),
);

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.status(200).json({ success: true, data: result });
  }),
);

