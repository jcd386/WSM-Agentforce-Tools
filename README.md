# WSM Agentforce Tools

Understand and monitor Agentforce **Flex Credit** spend inside any Salesforce org.

One app page, two tabs:

- **Credit Calculator** — what will Agentforce cost? Model prompts, agent actions, discounts and percent-of-spend uplifts, in credits and dollars.
- **Digital Wallet Alerts** — tell me before we run out. A daily scheduled flow watches the org's real consumption and notifies chosen people when it crosses configured thresholds.

Built by [We Summit Mountains](https://wesummitmountains.com).

<a href="https://githubsfdeploy.herokuapp.com/app/githubdeploy/jcd386/WSM-Agentforce-Tools?ref=main">
  <img alt="Deploy to Salesforce" src="https://raw.githubusercontent.com/afawcett/githubsfdeploy/master/deploy.png">
</a>

---

## Prerequisite, and what happens without it

**The alerts half requires Salesforce to have provisioned Digital Wallet in the target org.** The flow calls the managed `computeConsumption` and `createConsumptionAlert` actions and references the `sfdw__ConsumptionAlert` Apex type. Where Digital Wallet is absent, those simply do not exist.

Salesforce deploys are atomic, so in an org without Digital Wallet the whole install fails — **including the calculator**, which needs nothing at all. The failure looks like:

```
Flow WSM_Agentforce_Credit_Alerts
  currentItem_Find_Equal_or_Higher_Alerts (Variable) - "apexClass" is invalid.
```

**Check first:**
```bash
sf api request rest "/services/data/v64.0/actions/standard" --target-org <alias> | grep -i consumption
```
Results → install everything. No results → use the calculator-only path below.

## Install

**Full install** (Digital Wallet present):
```bash
sf project deploy start --source-dir force-app --target-org <alias> \
  --test-level RunSpecifiedTests --tests WSM_DW_AlertSettingsControllerTest
```

**Calculator only** (no Digital Wallet, no prerequisites, no Apex):
```bash
sf project deploy start --manifest manifest/calculator-only.xml --target-org <alias>
```

Then:
1. Assign the **WSM Agentforce Tools** permission set.
2. Open **App Launcher → WSM Agentforce Tools**.
3. *(Alerts only)* Activate the flow **WSM - Digital Wallet Alerts** — flows always deploy inactive to production.
4. *(Alerts only)* On the **Digital Wallet Alerts** tab, pick an org-wide email sender, add recipients, and confirm the thresholds.

## Tab 1 — Credit Calculator

Agentforce bills in two **fundamentally different shapes**, and conflating them is the most expensive mistake in an Agentforce estimate:

| Shape | Formula | Applies to |
|---|---|---|
| **Token-based** | `credits = (tokens ÷ 2,000) × multiplier` | Prompts — Starter 2×, Basic 2×, Standard 4×, Advanced 16× |
| **Flat per event** | `credits = fixed rate` | Standard Action 20, Custom Action 20, Voice Action 30, Help Agent Resolution 400 |

A 50,000-token agent action costs **exactly 20 credits**, not 400. Multiply a flat rate by a token count and you overstate cost by 25×. The calculator makes the choice explicit so the two cannot be mixed up, and disables the token input in flat mode rather than hiding it.

Also handles:
- **Blended requests** — 1 prompt + N agent actions, which is what a real agent turn costs
- **Production vs Sandbox** — flat rates differ (Actions 20→16, Voice 30→24); prompt tiers do not
- **Discount % or negotiated $ per 100K** — linked, enter whichever you know
- **Uplift %** for anything billed as a share of total spend, such as Shield — scales dollars only, never credits
- Credits *and* dollars across per request / per 1,000 / per month / per year

**Customer 360 Platform** usage (Flows, Apex, record CRUD) is published by Salesforce as **TBA**. The calculator shows it as unpriced and refuses to estimate it. Any number you have seen for it is a guess.

## Tab 2 — Digital Wallet Alerts

Salesforce's built-in consumption alert is a **custom notification** — bell icon and mobile push only. There is no email channel on custom notification types, and `recipientIds` accepts only User IDs, so it cannot reach anyone without a licence. If nobody is watching the bell at midnight, nothing tells you.

This adds an email path and makes both audiences configurable without editing a flow:

- **Recipients** — a Salesforce user (in-app notification), an email address (external, no licence needed), or both. When a user is linked, `Effective_Email__c` derives the address from the User record, so a changed Salesforce email is picked up with nothing to re-save.
- **Thresholds** — percent-consumed levels, seeded 50/70/80/85/90/95/100.
- **Sender** — chosen from the org's verified organization-wide addresses. Blank means no emails; in-app still works.

**Only one alert fires per card per run** — the highest threshold that card has crossed. Adding thresholds changes *which* level is reported, not how many alerts arrive.

Two safety rules are enforced and worth knowing before changing anything:

- **The 100% threshold cannot be removed or deactivated.** The flow's overage check is literally `Thresholds == 100`; it is the only path that lets a prepaid card alert again after an alert already exists.
- **Clearing the recipient list does not silence alerts** — it falls back to every active system administrator, so the config cannot go quiet by accident.

## Keeping the rates current

Salesforce republishes the Flex Credits rate card on no fixed schedule. Two dates appear in the calculator's footer and mean different things:

- **Rate card effective date** — printed on Salesforce's card
- **Last verified** — when a human last checked this code against it

A recent verification against an older card is the normal healthy state. To update, edit the constants at the top of `wsmAgentforceRateCard.js` and bump `RATES_VERIFIED`. The calculator, the reference tables and the environment tooltip are all derived from those constants, so there is one place to change.

- [Agentforce rates and action multipliers](https://www.salesforce.com/agentforce/rates/)
- [Agentforce pricing](https://www.salesforce.com/agentforce/pricing/)

## What it touches

| Half | Footprint |
|---|---|
| Calculator | **Nothing.** Four LWCs doing arithmetic in the browser. No Apex, no objects, no records read or written, no callouts. |
| Alerts | 2 custom objects, 1 hierarchy custom setting, 1 Apex controller + test, 1 scheduled flow. Reads Digital Wallet consumption; writes only its own config records. |

## Behaviours to preserve if you modify the math

The pricing logic lives in pure functions in `wsmAgentforceRateCard.js` with no DOM dependency, so it can be exercised in plain Node.

- Blank monthly requests means **0**; blank negotiated price means **list**. Deliberately asymmetric.
- A typed `0` is a real value, not "blank".
- Flat-rate credits are **independent of token count**.
- Uplift scales **dollars only**.
- Round at render, never mid-calculation — `round(monthly) × 12` is wrong.

## License

Internal WSM tool. Rates are published Salesforce pricing; the code is ours.
