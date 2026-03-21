//worldcore/test/contract_frontendOpeningLoopReceiptTruth.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function resolveRepoRoot(): string {
  const here = __dirname;
  const candidates = [
    path.resolve(here, '../..'),
    path.resolve(here, '../../..'),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'web-frontend', 'components', 'city', 'createMePageActions.ts')) &&
      fs.existsSync(path.join(candidate, 'web-frontend', 'components', 'worldResponse', 'MissionResponsePanel.tsx'))
    ) {
      return candidate;
    }
  }
  throw new Error(`Unable to resolve repo root from ${here}`);
}

function read(repoRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function mustContain(text: string, needle: string, label: string): void {
  assert.ok(text.includes(needle), label);
}

test('[contract] frontend opening loop receipts stay operation-linked, persisted, and unified on the mission board', () => {
  const repoRoot = resolveRepoRoot();
  const actionsText = read(repoRoot, 'web-frontend/components/city/createMePageActions.ts');
  const controllerText = read(repoRoot, 'web-frontend/components/city/useMePageController.ts');
  const missionPanelText = read(repoRoot, 'web-frontend/components/worldResponse/MissionResponsePanel.tsx');
  const mePageText = read(repoRoot, 'web-frontend/pages/MePage.tsx');

  mustContain(actionsText, 'function getOpeningOperationReceiptKey(operation: SettlementOpeningOperation): string', 'createMePageActions should keep the opening-operation receipt key helper');
  mustContain(actionsText, 'impactSummary?: string | null', 'createMePageActions should still thread impactSummary through action success summaries');
  mustContain(actionsText, 'pushOpeningReceipt(label, detail, outcome, impactSummary, receiptActionKey);', 'createMePageActions should still push opening receipts with impact summaries and action keys');
  mustContain(actionsText, 'handleExecuteOpeningOperation', 'createMePageActions should still expose the opening-operation execution helper');
  mustContain(actionsText, 'const receiptActionKey = getOpeningOperationReceiptKey(operation);', 'opening-operation execution should still derive a stable receipt action key');

  mustContain(controllerText, 'actionKey?: string;', 'OpeningActionReceipt should still carry an optional actionKey');
  mustContain(controllerText, 'impactSummary?: string;', 'OpeningActionReceipt should still carry an optional impactSummary');
  mustContain(controllerText, 'const key = `${receipt.actionKey ?? ""}__${receipt.title}__${receipt.detail}__${receipt.impactSummary ?? ""}__${receipt.outcome}`;', 'receipt dedupe should still include actionKey and impactSummary in its identity');
  mustContain(controllerText, 'const OPENING_RECEIPTS_STORAGE_PREFIX = "planarwar:opening-action-receipts:v2:";', 'opening receipts should still persist under the v2 storage key');
  mustContain(controllerText, 'setOpeningActionReceipts(readStoredOpeningActionReceipts(cityId));', 'controller should still rehydrate opening receipts per city');
  mustContain(controllerText, 'writeStoredOpeningActionReceipts(cityId, openingActionReceipts);', 'controller should still persist opening receipts after changes');

  mustContain(missionPanelText, 'function getLatestOpeningReceiptByActionKey(receipts: OpeningActionReceipt[]): Map<string, OpeningActionReceipt>', 'MissionResponsePanel should still derive per-operation latest receipts by action key');
  mustContain(missionPanelText, 'Latest field results', 'MissionResponsePanel should still render the unified recent results strip');
  mustContain(missionPanelText, 'Immediate receipts', 'MissionResponsePanel should still render the immediate opening receipt section');
  mustContain(missionPanelText, 'Latest result for this step', 'MissionResponsePanel should still surface the latest result inside each opening step card');
  mustContain(missionPanelText, 'formatRecentAgeLabel', 'MissionResponsePanel should still calculate relative age labels for receipt aging');
  mustContain(missionPanelText, 'Newest', 'MissionResponsePanel should still highlight the freshest result');
  mustContain(missionPanelText, 'Clear receipts', 'MissionResponsePanel should still allow clearing opening receipts');
  mustContain(missionPanelText, 'Dismiss', 'MissionResponsePanel should still allow dismissing an individual receipt');

  mustContain(mePageText, 'openingActionReceipts={openingActionReceipts}', 'MePage should still pass openingActionReceipts into MissionResponsePanel');
  mustContain(mePageText, 'onDismissOpeningReceipt={dismissOpeningActionReceipt}', 'MePage should still pass dismissOpeningActionReceipt into MissionResponsePanel');
  mustContain(mePageText, 'onClearOpeningReceipts={clearOpeningActionReceipts}', 'MePage should still pass clearOpeningActionReceipts into MissionResponsePanel');
});
