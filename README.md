# Inter-Island Exchange (IIE)

A secure digital marketplace and trade platform connecting buyers and sellers across CARICOM.

**Status:** Phase 0 complete (audit and architecture). Phase 1 (core foundation) is planned and
awaiting approval. There is no application code yet.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/IIE_PLATFORM_AUDIT.md`](docs/IIE_PLATFORM_AUDIT.md) | Phase 0 audit, phased plan, and minimum scope for the St. Lucia → St. Vincent pilot transaction |
| [`docs/IIE_PLATFORM_ARCHITECTURE.md`](docs/IIE_PLATFORM_ARCHITECTURE.md) | Proposed production architecture and open decisions |
| [`docs/IIE_DEVELOPMENT_ROADMAP.md`](docs/IIE_DEVELOPMENT_ROADMAP.md) | Phase status and the detailed plan for the next phase |
| [`docs/MOCK_FUNCTIONALITY_AUDIT.md`](docs/MOCK_FUNCTIONALITY_AUDIT.md) | Tracker for every button, link and form that is not yet fully functional |

Further documents (database schema, API, state machine, country engine, payments, logistics,
compliance, security) are written in the phase that builds them; see the architecture doc §14.

## Important

IIE software does not hold customer funds. Buyer payments are held and released by a licensed
payment, banking, or escrow provider; IIE records and orchestrates those holds as a
"Transaction Safeguard".
