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
    discountPercent,
    priceFromDiscount,
    toNumber,
    formatInt
} from 'c/wsmAgentforceRateCard';

const COMMIT_DELAY_MS = 250;

const MODES = [
    {
        value: 'token',
        label: 'Token-based (prompt)',
        detail: 'credits = tokens ÷ 2,000 × multiplier'
    },
    {
        value: 'flat',
        label: 'Flat per event',
        detail: 'credits = fixed rate · tokens don’t matter'
    },
    {
        value: 'blended',
        label: 'Blended request',
        detail: '1 prompt + N agent actions'
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
        ];
    }

    /**
     * Built from FLAT_EVENTS rather than written by hand, so the tooltip cannot
     * drift away from the rates the calculator actually uses when Salesforce
     * republishes the rate card.
     */
    get environmentHelp() {
        const deltas = FLAT_EVENTS.map((e) =>
            e.sandbox === null || e.sandbox === undefined
                ? `${e.label} ${e.prod} (no published sandbox rate)`
                : `${e.label} ${e.prod} → ${e.sandbox}`
        ).join(', ');

        const scope =
            `Environment changes flat per-event rates only: ${deltas}. ` +
            `Prompt tiers (Starter, Basic, Standard, Advanced) consume the same credits in ` +
            `production and sandbox, so this setting never changes a token-based estimate. ` +
            `Data 360 and Speech Foundations also have separate sandbox rates, but this ` +
            `calculator does not price those.`;

        return this.isTokenMode
            ? `${scope} You are in token-based mode, so this setting does not affect the numbers shown.`
            : scope;
    }

    get tokenOptions() {
        return TOKEN_CHOICES.map((t) => ({
            label: formatInt(t),
            value: String(t)
        }));
    }

    get promptTierOptions() {
        return PROMPT_TIERS.map((t) => ({
            label: `${t.label} (${t.multiplier}×)`,
            value: t.key
        }));
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
        this.environment = event.detail.value;
    }

    handleCommonTokensChange(event) {
        this.commonTokens = event.detail.value;
    }

    handlePromptTierChange(event) {
        this.promptTierKey = event.detail.value;
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
