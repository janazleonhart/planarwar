// worldcore/tools/seedItemsFromJson.ts

import fs from "fs";
import path from "path";
import { db } from "../db/Database";
import { Logger } from "../utils/logger";

const log = Logger.scope("ITEM_SEED");

type RawItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  rarity: string;
  specializationId?: string;
};

async function importSet(
  filename: string,
  category: string,
  defaultMaxStack = 9999
) {
  const filePath = path.join(__dirname, "..", "data", "items", filename);
  log.info("Importing", { filePath, category });

  const rawText = fs.readFileSync(filePath, "utf8");
  const items = JSON.parse(rawText) as RawItem[];

  for (const it of items) {
    await db.query(
      `
      INSERT INTO items (
        id,
        item_key,
        name,
        description,
        rarity,
        category,
        specialization_id,
        icon_id,
        max_stack,
        flags,
        stats
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11
      )
      ON CONFLICT (id) DO UPDATE SET
        item_key         = EXCLUDED.item_key,
        name             = EXCLUDED.name,
        description      = EXCLUDED.description,
        rarity           = EXCLUDED.rarity,
        category         = EXCLUDED.category,
        specialization_id= EXCLUDED.specialization_id,
        icon_id          = EXCLUDED.icon_id,
        max_stack        = EXCLUDED.max_stack,
        flags            = EXCLUDED.flags,
        stats            = EXCLUDED.stats,
        updated_at       = NOW()
      `,
      [
        it.id,
        it.key,
        it.name,
        it.description,
        it.rarity,
        category,
        it.specializationId ?? null,
        null,                  // icon_id
        defaultMaxStack,
        {},                    // flags
        {},                    // stats
      ]
    );
  }

  log.success("Imported items", { file: filename, count: items.length });
}

async function main() {
  try {
    await importSet("herbs.json", "herb");
    await importSet("ore.json", "ore");
    await importSet("stone.json", "stone");
    await importSet("wood.json", "wood");
    await importSet("fish.json", "fish");
    await importSet("food.json", "food");
    await importSet("mana.json", "mana");

    log.success("Item seeding complete");
  } catch (err) {
    log.error("Item seeding failed", { err });
    process.exitCode = 1;
    return;
  }
}

main().then(() => {
  // Let any async DB stuff finish; process will exit when done.
});
