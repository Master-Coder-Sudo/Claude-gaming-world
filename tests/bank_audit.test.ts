import { describe, expect, it } from 'vitest';

import {
  auditBank,
  type BankAuditFinding,
  type BankLedgerAuditRow,
} from '../scripts/bank_audit.mjs';

// Fill a bank_ledger row's defaults (snake_case, as Postgres returns it); pass only
// the fields a case cares about. Every row is 'personal' with realm Claudemoon.
function L(o: Partial<BankLedgerAuditRow>): BankLedgerAuditRow {
  return {
    id: 0,
    realm: 'Claudemoon',
    character_id: 1,
    account_id: 1,
    op: 'deposit',
    item_id: null,
    count: null,
    instance: null,
    copper_delta: 0,
    purchased_slots_after: 0,
    container: 'personal',
    container_id: null,
    ...o,
  };
}

const findingKindsFor = (findings: BankAuditFinding[], characterId: number) =>
  findings.filter((f) => f.characterId === characterId).map((f) => f.kind);

describe('auditBank', () => {
  it('a clean ledger that reconstructs the bank state yields zero findings', () => {
    const clean = {
      ledgerRows: [
        { id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 2 },
        { id: 2, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 },
        { id: 3, character_id: 1, op: 'withdraw', item_id: 'wolf_fang', count: 1 },
        { id: 4, character_id: 1, op: 'buy_slots', copper_delta: -500, purchased_slots_after: 6 },
      ].map(L),
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 4 }], purchasedSlots: 6 } },
        },
      ],
    };
    expect(auditBank(clean)).toEqual([]);
  });

  it('each planted anomaly yields exactly its finding, grouped per character', () => {
    const planted = {
      ledgerRows: [
        // character 10 (absent from characters): withdrew what was never deposited.
        { id: 1, character_id: 10, op: 'withdraw', item_id: 'wolf_fang', count: 3 },
        // character 20: purchased_slots_after regresses 6 -> 0 across id order.
        {
          id: 2,
          character_id: 20,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 6,
        },
        {
          id: 3,
          character_id: 20,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 0,
        },
        // character 30 (absent from characters): a negative count row, net kept
        // non-negative by the prior deposit so ONLY the shape finding fires.
        { id: 4, character_id: 30, op: 'deposit', item_id: 'wolf_fang', count: 5 },
        { id: 5, character_id: 30, op: 'withdraw', item_id: 'wolf_fang', count: -1 },
      ].map(L),
      characters: [
        // character 20's bank matches its ledger net, isolating the regression.
        {
          id: 20,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 0 } },
        },
        // character 40 holds an item its (empty) ledger never recorded.
        {
          id: 40,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'iron_ore', count: 3 }], purchasedSlots: 0 } },
        },
      ],
    };

    const findings = auditBank(planted);
    expect(findings).toHaveLength(4);
    expect(findingKindsFor(findings, 10)).toEqual(['negative_net']);
    expect(findingKindsFor(findings, 20)).toEqual(['purchased_regression']);
    expect(findingKindsFor(findings, 30)).toEqual(['bad_count']);
    expect(findingKindsFor(findings, 40)).toEqual(['ledger_state_mismatch']);

    // The finding shape carries container / realm / characterId / kind / detail.
    expect(findings.find((f) => f.characterId === 40)).toMatchObject({
      container: 'personal',
      realm: 'Claudemoon',
      characterId: 40,
      kind: 'ledger_state_mismatch',
    });
    for (const f of findings) expect(typeof f.detail).toBe('string');
  });

  it('reconciles ledger activity against an EMPTY bank when the state has none', () => {
    // Ledger rows for a character whose persisted state carries no bank at all is
    // a corruption signature (found live in Phase 4 verification: the audit used
    // to SKIP bankless characters entirely). A pre-bank character with no ledger
    // activity must still be skipped, never flagged.
    const findings = auditBank({
      ledgerRows: [
        { id: 1, character_id: 50, op: 'deposit', item_id: 'wolf_fang', count: 5 },
        { id: 2, character_id: 50, op: 'buy_slots', copper_delta: -500, purchased_slots_after: 6 },
        { id: 3, character_id: 51, op: 'deposit', item_id: 'iron_ore', count: 2 },
      ].map(L),
      characters: [
        { id: 50, realm: 'Claudemoon', state: null }, // NULL state, ledger activity
        { id: 51, realm: 'Claudemoon', state: { pos: { x: 0, z: 0 } } }, // state without bank
        { id: 52, realm: 'Claudemoon', state: null }, // pre-bank, no activity: skipped
      ],
    });
    expect(findingKindsFor(findings, 50)).toEqual(['ledger_state_mismatch', 'purchased_mismatch']);
    expect(findingKindsFor(findings, 51)).toEqual(['ledger_state_mismatch']);
    expect(findingKindsFor(findings, 52)).toEqual([]);
  });

  it('flags a negative count in the persisted bank state itself', () => {
    const findings = auditBank({
      ledgerRows: [],
      characters: [
        {
          id: 5,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: -2 }], purchasedSlots: 0 } },
        },
      ],
    });
    // A negative state count (shape) plus the net-vs-state mismatch it implies.
    expect(findingKindsFor(findings, 5)).toContain('negative_state_count');
  });
});
