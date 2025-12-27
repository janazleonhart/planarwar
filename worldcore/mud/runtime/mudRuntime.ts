//worldcore/mud/runtime/mudRuntime.ts

export function getSelfEntity(ctx: any): any | null {
    if (!ctx.entities?.getEntityByOwner) return null;
    return ctx.entities.getEntityByOwner(ctx.session.id) ?? null;
  }