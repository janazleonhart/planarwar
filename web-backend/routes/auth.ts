// webend-backend/src/routes/auth.ts

import { Router } from "express";
import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";

const router = Router();
const auth = new PostgresAuthService();

/**
 * POST /auth/register
 * body: { email, displayName, password }
 */
router.post("/register", async (req, res) => {
  const { email, displayName, password } = req.body as {
    email?: string;
    displayName?: string;
    password?: string;
  };

  if (!email || !displayName || !password) {
    return res.status(400).json({ error: "email, displayName, password required" });
  }

  try {
    const result = await auth.registerAccount(email, displayName, password);

    return res.json({
      ok: true,
      account: result.account,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (err: any) {
    // crude uniqueness handling; you can make this nicer later
    if (String(err.message).includes("duplicate key")) {
      return res.status(409).json({ error: "email_or_name_taken" });
    }

    console.error("[AUTH] register error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /auth/login
 * body: { emailOrName, password }
 */
router.post("/login", async (req, res) => {
  const { emailOrName, password } = req.body as {
    emailOrName?: string;
    password?: string;
  };

  if (!emailOrName || !password) {
    return res.status(400).json({ error: "emailOrName and password required" });
  }

  try {
    const result = await auth.loginWithPassword(emailOrName, password);

    return res.json({
      ok: true,
      account: result.account,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (err: any) {
    if (String(err.message) === "invalid_credentials") {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    console.error("[AUTH] login error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
