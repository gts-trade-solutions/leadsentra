import { db } from "@/lib/db";

/** Returns the credit balance for a user (0 if no wallet row). */
export async function getWalletBalance(userId: string): Promise<number> {
  const [rows] = await db.execute(
    "SELECT balance FROM credits_wallets WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return Number((rows as any[])[0]?.balance ?? 0);
}
