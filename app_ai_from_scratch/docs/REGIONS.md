# Region audit · what changes and what is broken

Date: 2026-08-21. Four markets: Colombia, the United States, LATAM and the European Union.
Each section says what was implemented, what objection that market brings and **what blocks the sale today**.

Detection: `web/src/lib/region.ts`. Order of reliability: CDN geo header
(`cf-ipcountry`, `x-vercel-ip-country`, …) → region from `Accept-Language` → neutral.
**The operating system does not report a country.** That is why the narrative never depends on
guessing right: if it is not known, the `global` variant is what ships, and it promises nothing
specific to any country.

Copy: `web/src/lib/narrative.ts`, four markets × two languages.
Used on `/` (band in §05 price) and on `/pago` (trust band, payment methods,
guarantee text).

---

## 1. Colombia — primary market

| | |
|---|---|
| Narrative | «Hecho en Medellín». Closeness and a real name: whoever is selling has a face. |
| Real objection | "why in dollars?" — a price in USD reads as a gringo's price. |
| How it is answered | It says explicitly that the bank converts at the day's rate and may add a fee. |
| Methods | Card · PSE · Cash (Efecty) · Mercado Pago wallet |
| Status | **Works.** It is the only market with all four methods. |

## 2. LATAM (MX, AR, CL, PE, EC, BR…)

| | |
|---|---|
| Narrative | «Entender la IA sin que te la expliquen en inglés». The language is the argument. |
| Real objection | The issuing bank declining the international charge. |
| How it is answered | It warns before paying: if it is declined, call the bank and authorise it. |
| Methods | Card · wallet. **PSE and Efecty are Colombia-only** and are no longer shown outside it. |
| Status | Works with reservations: the cross-border card decline rate in LATAM is high. |
| Pending | Pricing in local currency (MXN, ARS, CLP) would raise conversion, but it requires another gateway. |

## 3. United States

| | |
|---|---|
| Narrative | «Cinco horas, no un bootcamp de seis semanas». Against the market of inflated courses. |
| Real objection | Inverted: **the price is so low that it breeds distrust.** |
| How it is answered | «No es gancho: no hay plan pro» + zero analytics + 14-day refund. |
| Methods | International card only. |
| **Blocker** | **Mercado Pago does not operate in the US.** The charge comes from a Colombian merchant: the issuing bank can decline it, and there is no Apple Pay and no ACH. |
| Fix | Stripe as a second gateway (`/api/payments/stripe/*` in parallel, same `payments` table). Until then the page tells the truth: if it is declined, write in and an alternate link is sent. |

## 4. European Union (+ United Kingdom, Norway, Switzerland)

| | |
|---|---|
| Narrative | «Sin analítica y sin banner de cookies». Privacy as a product, not as a legal notice. |
| Real objection | Who is this seller, what do they do with my data, and can I get a refund? |
| How it is answered | 14-day right of withdrawal citing Directive 2011/83/EU, three necessary cookies, account deletion from Ajustes. |
| Methods | International card only. |
| **Blocker 1** | **Mercado Pago does not operate in the EU.** Same problem as the US. |
| **Blocker 2 (resolved)** | The guarantee said **7 days**: below the legal minimum of 14. Corrected in `i18n.ts`, `/pago`, the landing page and Ajustes. |
| Pending | VAT: today it is declared to be the buyer's responsibility. With real volume, OSS/IOSS or selling through a merchant of record (Paddle, Lemon Squeezy) has to be decided. |
| Pending | Hosting region: if the servers end up outside the EEA there is an international transfer. It is already declared in `/privacidad`; the provider has to be named once it is settled. |

---

## What costs money, in order

1. **Stripe** (or a merchant of record). Without it, the US and the EU cannot pay reliably, and they are the two markets that pay in dollars without it hurting.
2. **Local pricing in LATAM.** It cuts card declines more than any copy change.
3. **Deciding EU VAT** before volume turns it into a retroactive problem.

## What was deliberately NOT done

- Changing the price by region. Discriminating on price by IP with no legal or tax basis is a problem, not an optimisation.
- Translating the landing page into English by region. The landing page is still in Spanish; the platform itself is bilingual. When English arrives, the `us` market is the first one that justifies it.
- Geoblocking. Nobody is shut out: whoever does not fit a market sees the neutral narrative.
