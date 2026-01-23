// worldcore/vendors/VendorService.ts

import type { VendorDefinition } from "./VendorTypes";

export type GetVendorOptions = {
  /** If true, the service may apply restock + dynamic pricing before returning. */
  forTrade?: boolean;
};

export interface VendorService {
  getVendor(id: string, opts?: GetVendorOptions): Promise<VendorDefinition | null>;

  // Optional; handy for admin / debug browsers later.
  listVendors(): Promise<{ id: string; name: string }[]>;

  /** Best-effort: apply a player purchase (reduce stock). */
  applyPurchase?(vendorItemRowId: number, quantity: number): Promise<void>;

  /** Best-effort: apply a player sale (increase stock). */
  applySale?(vendorItemRowId: number, quantity: number): Promise<void>;
}
