# Farol

**Brazil's tax reform, client by client.** Farol ("lighthouse") reads the electronic invoices of an accounting firm's clients, watches for regulatory changes, and shows which clients each change affects, by how much in reais, and what notice to send. The accountant approves everything before it goes out.

Built for Hack Brasil 2026. [Versão em português](README.md) (the complete reference) · [3-minute demo script, in Portuguese](docs/roteiro-demo.md)

> **Prototype.** The demo portfolio is synthetic and is calculated with an EXAMPLE classification table (codes starting with `EX`). Real clients use the official table. Tax rates from 2027 onward are estimates and are marked as such in the interface. Nothing here is tax advice.

## Background

Brazil is replacing five consumption taxes (PIS, Cofins, ICMS, ISS, IPI) with two value-added taxes, CBS and IBS, in a transition that runs from 2026 to 2033 (Complementary Law 214/2025). Every invoice line must carry a tax classification code, the `cClassTrib`, which decides whether the product pays the full rate or a reduced one. The same product code (NCM) can map to more than one `cClassTrib`, so someone has to decide. Tax will also be withheld at payment time ("split payment"), which changes each company's cash flow.

An accounting firm has hundreds of clients and has to work out this effect for each of them.

## What Farol does

1. **Portfolio.** Upload a client's NF-e/NFC-e XML files, loose or in a ZIP. Farol classifies each product, projects the monthly tax burden for 2026 to 2033, estimates the cash effect of split payment, and ranks clients by how much their burden changes in 2027.
2. **Review queue.** When a product's NCM allows more than one treatment, Farol does not pick. It uses the most conservative one in the calculation and waits for the accountant. On request, it suggests a code and quotes the official annex text the suggestion rests on.
3. **Radar.** Every day Farol downloads the official `cClassTrib` table and compares it with the one each firm uses. A difference becomes a change in the Radar. Once the accountant confirms the reading, Farol shows the affected clients, the variation in reais per month, and a draft notice. The accountant edits, approves, and Farol sends it by e-mail.

## Rules the code enforces

- **No number comes from an LLM.** All calculations are plain functions in `packages/core`, and each result stores the versions of the table and of the parameters used.
- **The accountant approves everything.** A change produces no impact until it is confirmed. A notice is not sent without the approval click, which is recorded. A suggestion never enters the calculation; only the accountant's decision does.
- **Suggestions quote their source.** A suggestion is discarded unless its code is among the candidates for that NCM and its quoted excerpt exists, character for character, in the official text.
- **Official data is traceable.** The classification table is imported from the official portal with its source, download date and SHA-256.
- **Privacy (LGPD).** Consumer CPFs are masked when the invoice is read. The XML is not stored, only the normalized items. Every query is filtered by the firm of the logged-in user. Only the NCM, the product description and official text can reach an external AI service.
- **Synthetic data stays labeled.** Real clients can't be calculated with the example table, and the demo can't be mixed with real clients.

## How suggestions work without a paid model

The default suggester costs nothing and makes no network calls. It compares the words of the product description with the official annex items for that NCM, and it says so. When the text doesn't settle the question, it gives no suggestion and explains why. An LLM can be plugged in through any service compatible with the OpenAI chat API, including a local model, by setting `FAROL_IA_URL` and `FAROL_IA_MODELO`; its answers go through the same validation.

`npm run avaliar -w @farol/core -- gold.csv` measures accuracy against a gold set labeled by an accountant (CSV with `ncm;descricao;cclasstrib`). The repository does not include a gold set.

## Run it

Requires Node 22.18 or newer and a WorkOS account for login.

1. In the WorkOS dashboard, under *Redirects*, register `http://localhost:3000/callback` as a redirect URI and `http://localhost:3000` as the sign-out URI. Create `apps/web/.env.local`:

   ```sh
   WORKOS_CLIENT_ID=client_...
   WORKOS_API_KEY=sk_test_...
   WORKOS_COOKIE_PASSWORD=...   # 32+ characters
   NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
   ```

2. Start it:

   ```bash
   npm install
   npm run convex     # terminal 1: Convex backend (first run: choose to run locally without an account)
   cd apps/web && npx convex env set WORKOS_CLIENT_ID client_...   # once
   npm run dev        # terminal 2: http://localhost:3000
   ```

3. Sign in. The first login asks for the firm's name. With an empty portfolio, **Carregar carteira de demonstração** loads four synthetic clients and two fictitious changes.

Checks, the same ones CI runs:

```bash
npm run typecheck
npm test           # 45 core tests (node:test) + 20 Convex function tests (convex-test)
npm run build
```

Optional integrations are configured with `npx convex env set NAME value` in `apps/web`. Without them the app still works: e-mail sending is simulated and labeled as such, suggestions use text comparison, and the plan page says billing is not configured.

| Variable | Effect |
| --- | --- |
| `RESEND_API_KEY`, `FAROL_REMETENTE`, `RESEND_WEBHOOK_SECRET` | Real e-mail through Resend, with delivery and open tracking |
| `FAROL_IA_URL`, `FAROL_IA_MODELO`, `FAROL_IA_CHAVE` | LLM suggestions through an OpenAI-compatible chat API |
| `ABACATEPAY_API_KEY`, `ABACATEPAY_PRODUTO_ID`, `ABACATEPAY_WEBHOOK_SECRET` | Plan billing through AbacatePay (Pix or card) |

## Architecture

```
packages/core/     @farol/core: rules and calculations in pure TypeScript, no dependencies
                   XML and ZIP readers, NF-e parsing with CPF masking, classification, projection,
                   split payment, change impact, notice drafts, suggester, table diff (Vigia),
                   official table importer, integrations (Resend, AbacatePay)
apps/web/          Next.js (App Router) + Convex
  convex/          schema, auth (WorkOS AuthKit), per-firm isolation, calculation engine,
                   uploads, Radar, suggestions, daily jobs, webhooks
  app/             screens: Carteira (portfolio), Radar, Plano (plan)
```

The interface is in Brazilian Portuguese, as are the identifiers in the code, because the domain vocabulary (cClassTrib, NCM, CBS, IBS) is Brazilian.

## Status

Working and tested: invoice reading, official table import, projection, review queue, suggestions, daily table watch, impact, notices with approval, ZIP upload, per-firm isolation.

Tested only against simulated services, because no production keys were available: real Resend delivery and webhook, LLM suggestions, AbacatePay checkout and webhook.

Not done: official 2027+ rates (not published yet), a gold set labeled by accountants, watching free-text sources such as technical notes, services (NBS/NFS-e), and what the paid plan unlocks. The full list is under "Próximos passos" in the [Portuguese README](README.md).
