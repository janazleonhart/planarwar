// worldcore/vendors/VendorService.ts

import type { VendorDefinition } from "./VendorTypes";

export interface VendorService {
  getVendor(id: string): Promise<VendorDefinition | null>;

  // Optional; handy for admin / debug browsers later.
  listVendors(): Promise<{ id: string; name: string }[]>;
}
