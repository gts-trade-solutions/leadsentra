import { randomUUID } from "crypto";
import { db } from "./db";
import {
  DEFAULT_LBI_BLOCKS,
  DEFAULT_TEMPLATE_NAME,
  type OfferBlock,
  type OfferTemplate,
} from "./offerTemplate";

/**
 * DB access for offer templates. Each user gets the built-in RACE INTELLECT
 * (LBI) layout seeded as their default the first time templates are read, so
 * the feature works out of the box and the default is then editable in-app.
 */

function parseBlocks(raw: any): OfferBlock[] {
  if (Array.isArray(raw)) return raw as OfferBlock[];
  try {
    const v = JSON.parse(String(raw || "[]"));
    return Array.isArray(v) ? (v as OfferBlock[]) : [];
  } catch {
    return [];
  }
}

function mapRow(row: any): OfferTemplate {
  return {
    id: row.id,
    name: row.name,
    is_default: !!row.is_default,
    content: parseBlocks(row.content),
  };
}

/** Insert the built-in LBI template as the user's default. */
export async function seedDefaultTemplate(userId: string): Promise<OfferTemplate> {
  const id = randomUUID();
  await db.execute(
    "INSERT INTO offer_templates (id, user_id, name, is_default, content) VALUES (?, ?, ?, 1, ?)",
    [id, userId, DEFAULT_TEMPLATE_NAME, JSON.stringify(DEFAULT_LBI_BLOCKS)]
  );
  return { id, name: DEFAULT_TEMPLATE_NAME, is_default: true, content: DEFAULT_LBI_BLOCKS };
}

/** List a user's templates, seeding the default if they have none. */
export async function listTemplates(userId: string): Promise<OfferTemplate[]> {
  const [rows] = await db.execute(
    "SELECT id, name, is_default, content FROM offer_templates WHERE user_id = ? ORDER BY is_default DESC, name ASC",
    [userId]
  );
  let list = rows as any[];
  if (!list.length) {
    await seedDefaultTemplate(userId);
    const [rows2] = await db.execute(
      "SELECT id, name, is_default, content FROM offer_templates WHERE user_id = ? ORDER BY is_default DESC, name ASC",
      [userId]
    );
    list = rows2 as any[];
  }
  return list.map(mapRow);
}

export async function getTemplate(userId: string, id: string): Promise<OfferTemplate | null> {
  const [rows] = await db.execute(
    "SELECT id, name, is_default, content FROM offer_templates WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = (rows as any[])[0];
  return row ? mapRow(row) : null;
}

/** The user's default template (seeding one if necessary). */
export async function getDefaultTemplate(userId: string): Promise<OfferTemplate> {
  const [rows] = await db.execute(
    "SELECT id, name, is_default, content FROM offer_templates WHERE user_id = ? ORDER BY is_default DESC, name ASC LIMIT 1",
    [userId]
  );
  const row = (rows as any[])[0];
  if (row) return mapRow(row);
  return seedDefaultTemplate(userId);
}

/**
 * Resolve the block list to render an offer with: the named template if found,
 * else the user's default, else the built-in LBI blocks.
 */
export async function resolveBlocksForOffer(
  userId: string,
  templateId: string | null
): Promise<OfferBlock[]> {
  if (templateId) {
    const t = await getTemplate(userId, templateId);
    if (t && t.content.length) return t.content;
  }
  try {
    const def = await getDefaultTemplate(userId);
    if (def.content.length) return def.content;
  } catch {
    /* fall through */
  }
  return DEFAULT_LBI_BLOCKS;
}

export async function createTemplate(
  userId: string,
  name: string,
  content: OfferBlock[],
  isDefault: boolean
): Promise<OfferTemplate> {
  const id = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (isDefault) {
      await conn.execute("UPDATE offer_templates SET is_default = 0 WHERE user_id = ?", [userId]);
    }
    await conn.execute(
      "INSERT INTO offer_templates (id, user_id, name, is_default, content) VALUES (?, ?, ?, ?, ?)",
      [id, userId, name, isDefault ? 1 : 0, JSON.stringify(content)]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { id, name, is_default: isDefault, content };
}

export async function updateTemplate(
  userId: string,
  id: string,
  patch: { name?: string; content?: OfferBlock[]; is_default?: boolean }
): Promise<boolean> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
    if (patch.content !== undefined) { sets.push("content = ?"); params.push(JSON.stringify(patch.content)); }
    if (patch.is_default !== undefined) {
      sets.push("is_default = ?");
      params.push(patch.is_default ? 1 : 0);
      if (patch.is_default) {
        await conn.execute("UPDATE offer_templates SET is_default = 0 WHERE user_id = ?", [userId]);
      }
    }
    if (!sets.length) { await conn.rollback(); return true; }
    params.push(id, userId);
    const [res] = await conn.execute(
      `UPDATE offer_templates SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      params
    );
    await conn.commit();
    return ((res as any)?.affectedRows || 0) > 0;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function deleteTemplate(userId: string, id: string): Promise<boolean> {
  const [res] = await db.execute(
    "DELETE FROM offer_templates WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return ((res as any)?.affectedRows || 0) > 0;
}
