// worldcore/vendors/VendorService.ts

import type { VendorDefinition } from "./VendorTypes";

export interface VendorService {
  getVendor(id: string): Promise<VendorDefinition | null>;

  // optional; handy for debug later
  listVendors(): Promise<{ id: string; name: string }[]>;
}
