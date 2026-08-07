import { LightningElement } from 'lwc';
import {
    computeProjection,
    PROMPT_TIERS,
    FLAT_EVENTS,
    TOKEN_CHOICES,
    DEFAULT_TOKENS,
    DEFAULT_PROMPT_TIER,
    DEFAULT_FLAT_EVENT,
    DEFAULT_MONTHLY_REQUESTS,
    LIST_PRICE_PER_100K,
    RATE_CARD_VERSION,
    RATES_VERIFIED,
    RATE_CARD_SOURCE_URL,
    PRICING_SOURCE_URL,
    LLM_SUPPORT_URL,
    discountPercent,
    priceFromDiscount,
    toNumber,
    formatInt
} from 'c/wsmAgentforceRateCard';

const COMMIT_DELAY_MS = 250;

const MODES = [
    {
        value: 'token',
        label: 'Pay by size (prompts)',
        detail: 'credits = tokens ÷ 2,000 × multiplier',
        title:
            'For prompts. The bigger the text, the more it costs: count the tokens, divide by 2,000, then multiply by the tier number.'
    },
    {
        value: 'flat',
        label: 'Fixed price per event',
        detail: 'same price every time · size does not matter',
        title:
            'For agent actions. Every event costs the same fixed number of credits, whether it is tiny or huge.'
    },
    {
        value: 'blended',
        label: 'Both together',
        detail: '1 prompt + agent actions, added up',
        title:
            'One real request is often a prompt plus a few agent actions. This adds the two costs together.'
    }
];

const DEFAULTS = {
    exactTokens: '',
    monthlyRequests: String(DEFAULT_MONTHLY_REQUESTS),
    negotiated: String(LIST_PRICE_PER_100K),
    discountPct: '0',
    uplift: '',
    actions: '1'
};

/** Trim float noise so the linked discount/price fields show clean values. */
function tidy(n) {
    return String(Math.round(n * 100) / 100);
}

/**
 * Owns all calculator input state. Derived values are computed in a single
 * getter and handed to children whole, so there is no duplicated derived state
 * and no possibility of a stale figure.
 *
 * No @track: every field is reassigned wholesale, which is already reactive, and
 * @track would risk LWS sanitizing string values.
 */
export default class WsmCreditCalculator extends LightningElement {
    // Surfaced in an always-visible footer so nobody has to trust the numbers
    // blindly — the provenance travels with the tool.
    rateCardVersion = RATE_CARD_VERSION;
    ratesVerified = RATES_VERIFIED;
    rateCardSourceUrl = RATE_CARD_SOURCE_URL;
    pricingSourceUrl = PRICING_SOURCE_URL;
    llmSupportUrl = LLM_SUPPORT_URL;

    mode = 'token';
    environment = 'prod';
    promptTierKey = DEFAULT_PROMPT_TIER;
    flatEventKey = DEFAULT_FLAT_EVENT;
    commonTokens = String(DEFAULT_TOKENS);

    // Bound to the inputs so typing feels instant.
    raw = { ...DEFAULTS };
    // Feeds the projection, committed on a short debounce so the result grid
    // does not flash while a field is transiently empty mid-keystroke.
    committed = { ...DEFAULTS };

    _timer;

    disconnectedCallback() {
        clearTimeout(this._timer);
    }

    /* ---------------- options ---------------- */

    get modeOptions() {
        return MODES.map((m) => ({
            ...m,
            selected: m.value === this.mode,
            cls:
                m.value === this.mode
                    ? 'wsm-seg wsm-seg_on'
                    : 'wsm-seg'
        }));
    }

    get environmentOptions() {
        return [
            { label: 'Production', value: 'prod' },
            { label: 'Sandbox', value: 'sandbox' }
        ].map((o) => {
            const on = o.value === this.environment;
            return {
                ...o,
                selected: on ? 'true' : 'false',
                tabindex: on ? '0' : '-1',
                cls: on ? 'wsm-chip wsm-chip_on' : 'wsm-chip'
            };
        });
    }

    get modeHelp() {
        return (
            'Salesforce charges for agents in two different ways, and mixing them up is the ' +
            'classic mistake. Prompts are pay-by-size: count the tokens, divide by 2,000, ' +
            'multiply by the tier number. Agent actions are fixed-price: the same number of ' +
            'credits every time, even for a huge job. Pick "Both together" to price a request ' +
            'that uses a prompt plus some actions.'
        );
    }

    /**
     * The generated tooltips are built from FLAT_EVENTS / PROMPT_TIERS rather
     * than written by hand, so they cannot drift away from the rates the
     * calculator actually uses when Salesforce republishes the rate card.
     */
    get environmentHelp() {
        const deltas = FLAT_EVENTS.map((e) =>
            e.sandbox === null || e.sandbox === undefined
                ? `${e.label} ${e.prod} (no sandbox price published)`
                : `${e.label} ${e.prod} → ${e.sandbox}`
        ).join(', ');

        const scope =
            `Production is your real, live org. Sandbox is the practice copy, and events are ` +
            `usually a little cheaper there. This choice only changes the fixed per-event prices: ` +
            `${deltas}. Prompts cost the same credits in both, so it never changes a ` +
            `pay-by-size answer.`;

        return this.isTokenMode
            ? `${scope} You are in pay-by-size mode right now, so this setting is not changing your numbers.`
            : scope;
    }

    get eventTypeHelp() {
        const inSandbox = this.environment === 'sandbox';
        const rates = FLAT_EVENTS.map((e) => {
            const rate = inSandbox ? e.sandbox : e.prod;
            return rate === null || rate === undefined
                ? `${e.label} has no published price`
                : `${e.label} costs ${rate}`;
        }).join(', ');
        return (
            `Pick the kind of thing the agent does. Each kind costs a fixed number of credits ` +
            `every time it happens, no matter how big the job is. Right now (${
                inSandbox ? 'sandbox' : 'production'
            }): ${rates}.`
        );
    }

    get promptTierHelp() {
        const tiers = PROMPT_TIERS.map((t) => `${t.label} ${t.multiplier}×`).join(', ');
        return (
            `The tier is the level of AI model the prompt uses. A higher tier is smarter but ` +
            `uses more credits for the same amount of text. The × number is the multiplier in ` +
            `the math: ${tiers}. Example: 4,000 tokens on Standard (4×) is 4,000 ÷ 2,000 × 4 = 8 ` +
            `credits. Starter means a model you bring yourself; the other three are models ` +
            `Salesforce runs for you. Salesforce moves models between tiers as new ones ship, so ` +
            `use the link next to this label to check the current list rather than trusting a copy.`
        );
    }

    get formulaHelp() {
        if (this.isFlatMode) {
            return (
                'This is the math behind the numbers on the right. In fixed-price mode there is ' +
                'no math to do: every event costs the same set number of credits, so we just ' +
                'multiply that price by how many times it happens.'
            );
        }
        if (this.isBlendedMode) {
            return (
                'This is the math behind the numbers on the right. One request = the prompt part ' +
                '(tokens ÷ 2,000 × the tier number) plus the agent actions (each one a fixed ' +
                'credit price), all added together.'
            );
        }
        return (
            'This is the math behind the numbers on the right. Take the tokens, divide by 2,000, ' +
            'then multiply by the tier number. Example: 4,000 tokens on Standard (4×) is ' +
            '4,000 ÷ 2,000 × 4 = 8 credits.'
        );
    }

    /**
     * Chips are plain buttons, not a lightning-radio-group. The SLDS button
     * group renders as a single non-wrapping row, so ten token choices
     * overflowed the inputs column at every viewport width. These wrap.
     */
    get tokenOptions() {
        return TOKEN_CHOICES.map((t) => {
            const value = String(t);
            const on = value === this.commonTokens;
            return {
                label: formatInt(t),
                value,
                selected: on ? 'true' : 'false',
                tabindex: on ? '0' : '-1',
                cls: on ? 'wsm-chip wsm-chip_on' : 'wsm-chip'
            };
        });
    }

    get promptTierOptions() {
        return PROMPT_TIERS.map((t) => {
            const on = t.key === this.promptTierKey;
            return {
                label: `${t.label} (${t.multiplier}×)`,
                value: t.key,
                selected: on ? 'true' : 'false',
                tabindex: on ? '0' : '-1',
                cls: on ? 'wsm-chip wsm-chip_on' : 'wsm-chip'
            };
        });
    }

    get tokenChipRowClass() {
        return this.tokensDisabled ? 'wsm-chip-row wsm-chip-row_off' : 'wsm-chip-row';
    }

    get flatEventOptions() {
        return FLAT_EVENTS.map((e) => {
            const rate = this.environment === 'sandbox' ? e.sandbox : e.prod;
            const suffix = rate === null ? 'not published' : `${rate} cr`;
            return { label: `${e.label} — ${suffix}`, value: e.key };
        });
    }

    /* ---------------- derived ---------------- */

    get viewModel() {
        return computeProjection({
            mode: this.mode,
            environment: this.environment,
            exactTokensRaw: this.committed.exactTokens,
            commonTokens: this.commonTokens,
            promptTierKey: this.promptTierKey,
            flatEventKey: this.flatEventKey,
            actionsPerRequestRaw: this.committed.actions,
            monthlyRequestsRaw: this.committed.monthlyRequests,
            negotiatedRaw: this.committed.negotiated,
            upliftRaw: this.committed.uplift
        });
    }

    get isTokenMode() {
        return this.mode === 'token';
    }

    get isFlatMode() {
        return this.mode === 'flat';
    }

    get isBlendedMode() {
        return this.mode === 'blended';
    }

    /** Prompt inputs are live in token and blended modes. */
    get showPromptInputs() {
        return this.mode === 'token' || this.mode === 'blended';
    }

    /** Event picker is live in flat and blended modes. */
    get showEventInputs() {
        return this.mode === 'flat' || this.mode === 'blended';
    }

    /** In flat mode the token fields stay visible but disabled, so the user can
     *  see the thing that stopped mattering rather than wonder where it went. */
    get tokensDisabled() {
        return this.mode === 'flat';
    }

    get tokenFieldClass() {
        return this.tokensDisabled ? 'wsm-field wsm-field_off' : 'wsm-field';
    }

    get formulaClass() {
        return this.viewModel.unpublished
            ? 'wsm-formula wsm-formula_warn'
            : 'wsm-formula';
    }

    /* ---------------- handlers ---------------- */

    handleModeClick(event) {
        this.mode = event.currentTarget.dataset.mode;
    }

    handleEnvironmentChange(event) {
        this.environment = event.currentTarget.dataset.value;
    }

    handleCommonTokensChange(event) {
        if (this.tokensDisabled) {
            return;
        }
        this.commonTokens = event.currentTarget.dataset.value;
    }

    handlePromptTierChange(event) {
        this.promptTierKey = event.currentTarget.dataset.value;
    }

    handleFlatEventChange(event) {
        this.flatEventKey = event.detail.value;
    }

    handleRawChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.detail ? event.detail.value : event.target.value;
        const next = { ...this.raw, [field]: value === undefined || value === null ? '' : String(value) };

        // The dollar rate and the discount percent are two views of one number.
        // Editing either rewrites the other so they can never disagree.
        if (field === 'negotiated') {
            const price = toNumber(next.negotiated, LIST_PRICE_PER_100K);
            next.discountPct = tidy(discountPercent(price));
        }

        this.raw = next;
        this.scheduleCommit();
    }

    handleDiscountChange(event) {
        const value = event.detail ? event.detail.value : event.target.value;
        const raw = value === undefined || value === null ? '' : String(value);
        const pct = toNumber(raw, 0);
        this.raw = {
            ...this.raw,
            discountPct: raw,
            negotiated: tidy(priceFromDiscount(pct))
        };
        this.scheduleCommit();
    }

    scheduleCommit() {
        clearTimeout(this._timer);
        const snapshot = { ...this.raw };
        this._timer = setTimeout(() => {
            this.committed = snapshot;
        }, COMMIT_DELAY_MS);
    }

    handleReset() {
        clearTimeout(this._timer);
        this.mode = 'token';
        this.environment = 'prod';
        this.promptTierKey = DEFAULT_PROMPT_TIER;
        this.flatEventKey = DEFAULT_FLAT_EVENT;
        this.commonTokens = String(DEFAULT_TOKENS);
        this.raw = { ...DEFAULTS };
        this.committed = { ...DEFAULTS };
    }
}
