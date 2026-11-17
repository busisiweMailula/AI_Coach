import { ForbiddenError } from "./errors.js";
import type { AuthContext } from "../middleware/auth.js";

export function assertOwner(ownerId: string, actor: AuthContext): void {
  if (ownerId !== actor.userId) {
    throw new ForbiddenError("You do not have access to this resource");
  }
}

