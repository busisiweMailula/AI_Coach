import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { UnauthorizedError } from "../../common/errors.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { CONSENT_PURPOSES } from "./consent.model.js";
import { getConsentStatus, listConsents, recordConsent } from "./privacy.service.js";
import { withdrawPendingReviews } from "../reviews/reviews.service.js";

const updateConsentSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
}).strict();

export const privacyRouter = Router();
privacyRouter.use(authMiddleware, requireRole("candidate"));

privacyRouter.get(
  "/consents/status",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const status = await getConsentStatus(req.auth.userId);
    res.status(200).json({ success: true, data: status });
  }),
);

privacyRouter.get(
  "/consents",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const consents = await listConsents(req.auth.userId);
    res.status(200).json({
      success: true,
      data: consents.map(toConsentResponse),
    });
  }),
);

privacyRouter.put(
  "/consents",
  validateBody(updateConsentSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const consent = await recordConsent({
      ...req.body,
      ownerId: req.auth.userId,
      source: "settings",
    });
    if (consent.purpose === "human_review" && !consent.granted) {
      await withdrawPendingReviews(req.auth.userId);
    }
    res.status(200).json({ success: true, data: toConsentResponse(consent) });
  }),
);

function toConsentResponse(consent: Awaited<ReturnType<typeof recordConsent>>) {
  return {
    purpose: consent.purpose,
    policyVersion: consent.policyVersion,
    granted: consent.granted,
    recordedAt: consent.recordedAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    source: consent.source,
  };
}

