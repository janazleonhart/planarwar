//worldcore/mud/commands/craftCommand.ts

import { addItemToBags } from "../../items/InventoryHelpers";
import { listAllRecipes, findRecipeByIdOrName } from "../../tradeskills/RecipeCatalog";
import { recordActionProgress, updateTasksFromProgress, updateQuestsFromProgress } from "../MudProgression";
import { canConsumeRecipe, consumeRecipe } from "../../items/inventoryConsume";


export async function handleCraftCommand(ctx: any, char: any, parts: string[]): Promise<string> {
    if (!ctx.items) {
        return "Item service is not available.";
      }
      if (!ctx.characters) {
        return "Character service is not available.";
      }

      const sub = (parts[1] ?? "").toLowerCase();

      // craft / craft help / craft list
      if (!sub || sub === "help" || sub === "list") {
        const recipes = listAllRecipes();
        if (recipes.length === 0) {
          return "You do not know any crafting recipes yet.";
        }

        let out = "Known recipes:\n";
        for (const r of recipes) {
          out += ` - ${r.id}: ${r.name} [${r.category}]\n`;
        }
        out += "Use: craft <id|name> [count]";
        return out.trimEnd();
      }

      // craft <id|name> [count]
      const token = sub;
      const countArg = parts[2];
      const count = countArg ? Math.max(1, Number(countArg) || 1) : 1;

      const recipe = findRecipeByIdOrName(token);
      if (!recipe) {
        return `You do not know any recipe matching '${token}'. Use 'craft list' to see available recipes.`;
      }

      // Ensure all items exist in DB (inputs + outputs)
      for (const ing of recipe.inputs) {
        if (!ctx.items.get(ing.itemId)) {
          return `Recipe '${recipe.name}' requires unknown item '${ing.itemId}'. (Add it to DB first.)`;
        }
      }
      for (const out of recipe.outputs) {
        if (!ctx.items.get(out.itemId)) {
          return `Recipe '${recipe.name}' produces unknown item '${out.itemId}'. (Add it to DB first.)`;
        }
      }

      // 1) Check ingredients (atomic check)
      const check = canConsumeRecipe(char.inventory, recipe.inputs, count);
      if (!check.ok) {
        const def = ctx.items.get(check.itemId);
        const name = def?.name ?? check.itemId;
        return `You need ${check.need}x ${name}, but only have ${check.have}.`;
      }

      // 2) Remove ingredients (mutate inventory)
      if (!consumeRecipe(char.inventory, recipe.inputs, count)) {
        // Safety check: this should never happen because we pre-validated counts.
        return "An internal error occurred while removing ingredients.";
      }

      // 3) Add outputs (with mail overflow, like vendors/AH/loot)
      let totalMade = 0;
      let totalMailed = 0;

      for (const out of recipe.outputs) {
        const def = ctx.items.get(out.itemId)!; // already checked above
        const maxStack = def.maxStack ?? 1;
        const totalToMake = out.qty * count;

        let remaining = totalToMake;

        // Try bags first
        const leftover = addItemToBags(
          char.inventory,
          def.id,
          remaining,
          maxStack
        );
        const added = remaining - leftover;

        totalMade += added;
        remaining = leftover;

        // Any leftover goes to mail
        if (remaining > 0 && ctx.mail && ctx.session.identity) {
          await ctx.mail.sendSystemMail(
            ctx.session.identity.userId,
            "account",
            "Crafting overflow",
            `You crafted ${totalToMake}x ${def.name}, but some could not fit in your bags.`,
            [{ itemId: def.id, qty: remaining }]
          );
          totalMailed += remaining;
        }
      }

      // 4) Progression hooks (actions/tasks/quests)
      recordActionProgress(char, `craft_${recipe.category}`);
      recordActionProgress(char, "craft_any");
      updateTasksFromProgress(char);
      updateQuestsFromProgress(char);

      await ctx.characters.saveCharacter(char);

      let msg = `You craft ${count}x '${recipe.name}'.`;
      if (totalMade > 0) msg += ` ${totalMade} item(s) went into your bags.`;
      if (totalMailed > 0) msg += ` ${totalMailed} item(s) were sent to your mailbox.`;
      return msg;
  }
