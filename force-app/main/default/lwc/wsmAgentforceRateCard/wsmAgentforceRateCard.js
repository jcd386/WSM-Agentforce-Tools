/**
 * WSM Agentforce Rate Card — single source of truth for Flex Credit pricing.
 *
 * Every constant and every calculation lives here so that correctness can be
 * reviewed in one file. No DOM, no state, no imports from other components.
 *
 * Source: Salesforce Flex Credits Rate Card, effective 2026-06-17
 *         https://www.salesforce.com/agentforce/rates/
 *
 * THE ONE RULE THAT MATTERS: there are two billing shapes.
 *   Token-based (prompts): credits = (tokens / 2000) * multiplier
 *   Flat per event:        credits = fixed rate, tokens are IRRELEVANT
 * Never divide a FLAT_EVENTS rate by TOKENS_PER_CREDIT_BLOCK.
 */

/**
 * Two different dates, and the distinction matters to anyone questioning whether
 * these numbers are current:
 *   RATE_CARD_VERSION — the effective date printed on Salesforce's rate card.
 *   RATES_VERIFIED    — the day a human last checked this file against that card.
 * Salesforce republishes the card on no fixed schedule, so a recent verification
 * date against an older card is the normal healthy state.
 */
export const RATE_CARD_VERSION = '2026-06-17';
export const RATES_VERIFIED = '2026-08-01';
export const RATE_CARD_SOURCE_URL = 'https://www.salesforce.com/agentforce/rates/';
export const PRICING_SOURCE_URL = 'https://www.salesforce.com/agentforce/pricing/';
export const LLM_SUPPORT_URL =
    'https://help.salesforce.com/s/articleView?id=ai.generative_ai_large_language_model_support.htm&type=5';

export const TOKENS_PER_CREDIT_BLOCK = 2000;
export const LIST_PRICE_PER_100K = 500;
export const CREDITS_PER_PACK = 100000;
export const MONTHS_PER_YEAR = 12;

/** Token-based. credits = (tokens / TOKENS_PER_CREDIT_BLOCK) * multiplier */
export const PROMPT_TIERS = [
    { key: 'starter', label: 'Starter', multiplier: 2, note: 'Bring your own LLM' },
    { key: 'basic', label: 'Basic', multiplier: 2, note: 'Salesforce foundational LLM' },
    { key: 'standard', label: 'Standard', multiplier: 4, note: 'Salesforce foundational LLM' },
    { key: 'advanced', label: 'Advanced', multiplier: 16, note: 'Salesforce foundational LLM' }
];

/**
 * Flat per event. credits = fixed rate per execution, regardless of token count.
 * A 50,000-token agent action still costs exactly 20 credits.
 * `sandbox: null` means Salesforce has not published a sandbox rate.
 */
export const FLAT_EVENTS = [
    { key: 'standardAction', label: 'Standard Action', prod: 20, sandbox: 16 },
    { key: 'customAction', label: 'Custom Action', prod: 20, sandbox: 16 },
    { key: 'voiceAction', label: 'Voice Action', prod: 30, sandbox: 24 },
    { key: 'helpResolution', label: 'Help Agent Resolution', prod: 400, sandbox: null }
];

/** Named on the rate card but with no published rate. Never estimate these. */
export const UNPRICED = [
    {
        key: 'recordOperation',
        label: 'Salesforce Record Operation (CRUD)',
        status: 'TBA',
        note: 'Customer 360 Platform. Salesforce has not published a rate.'
    },
    {
        key: 'processInvocation',
        label: 'Salesforce Process Invocation (Flows, Apex)',
        status: 'TBA',
        note: 'Customer 360 Platform. Salesforce has not published a rate.'
    }
];

export const TOKEN_CHOICES = [
    2000, 4000, 8000, 10000, 20000, 30000, 40000, 50000, 75000, 100000
];

export const DEFAULT_TOKENS = 2000;
export const DEFAULT_PROMPT_TIER = 'standard';
export const DEFAULT_FLAT_EVENT = 'standardAction';
export const DEFAULT_MONTHLY_REQUESTS = 100;

/** Reference only — rendered, never calculated. Multipliers by monthly volume tier. */
export const DATA_360_TIERS = [
    'Up to 300K',
    '300K – 1.5M',
    '1.5M – 12.5M',
    'Over 12.5M',
    'Sandbox'
];

export const DATA_360_RATES = [
    { label: 'Data 360 Prep', unit: 'per 1M rows', rates: [40, 32, 16, 8, 32] },
    { label: 'Data 360 Unification', unit: 'per 1M rows', rates: [75000, 60000, 30000, 15000, 60000] },
    { label: 'Data 360 Segmentation', unit: 'per 1M rows', rates: [50, 40, 20, 10, 40] },
    { label: 'Data 360 Activation', unit: 'per 1M rows', rates: [60, 48, 24, 12, 48] },
    { label: 'Data 360 Zero-Copy Sharing-Out', unit: 'per 1M rows shared', rates: [60, 48, 24, 12, 48] },
    { label: 'Data 360 Queries', unit: 'per 1M rows', rates: [3, 2.4, 1.2, 0.6, 2.4] },
    { label: 'Data 360 Unstructured Processing', unit: 'per 1MB', rates: [150, 120, 60, 30, 120] },
    { label: 'Data 360 Intelligent Processing', unit: 'per 1MB', rates: [600, 480, 240, 120, 480] },
    { label: 'Data 360 Streaming Pipeline', unit: 'per 1M rows', rates: [3500, 2800, 1400, 700, 2800] },
    { label: 'Data 360 Real-Time Pipeline', unit: 'per 1M events', rates: [250000, 200000, 100000, 50000, 200000] },
    { label: 'Data 360 Code Extension', unit: 'per compute unit', rates: [40, 32, 16, 8, 32] }
];

export const SPEECH_RATES = [
    { label: 'Speech to Text', unit: 'per hour transcribed', rate: 150 },
    { label: 'Text to Speech', unit: 'per 1M characters', rate: 6000 },
    { label: 'Translation', unit: 'per 1M characters', rate: 4000 }
];

/* ------------------------------------------------------------------ */
/* Input coercion                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve a raw input string to a number.
 *
 * Number('') is 0, not NaN — a naive Number() silently turns a cleared
 * negotiated-price field into $0/credit and a 100% discount. This helper is the
 * only place blank is interpreted, and callers pass the fallback that applies to
 * their field. A typed '0' is a real value and survives, matching Flow, where
 * ISBLANK(0) is false.
 */
export function toNumber(raw, fallback) {
    if (raw === null || raw === undefined) {
        return fallback;
    }
    const trimmed = String(raw).replace(/,/g, '').trim();
    if (trimmed === '') {
        return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

/** One conversion used for BOTH list and negotiated, so the two can never drift. */
export function dollarsPerCredit(pricePer100k) {
    return pricePer100k / CREDITS_PER_PACK;
}

export function promptCredits(tokens, multiplier) {
    return (tokens / TOKENS_PER_CREDIT_BLOCK) * multiplier;
}

/** Flat rate for an event in the given environment. null when unpublished. */
export function flatEventCredits(eventKey, environment) {
    const event = FLAT_EVENTS.find((e) => e.key === eventKey);
    if (!event) {
        return null;
    }
    return environment === 'sandbox' ? event.sandbox : event.prod;
}

export function promptTier(tierKey) {
    return PROMPT_TIERS.find((t) => t.key === tierKey) || null;
}

export function flatEvent(eventKey) {
    return FLAT_EVENTS.find((e) => e.key === eventKey) || null;
}

export function discountPercent(negotiatedPer100k) {
    return (1 - negotiatedPer100k / LIST_PRICE_PER_100K) * 100;
}

/** Inverse of discountPercent — a 20% discount is $400 per 100,000 credits. */
export function priceFromDiscount(pct) {
    return LIST_PRICE_PER_100K * (1 - pct / 100);
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build the full credit and dollar projection.
 *
 * Everything is computed at full float precision; rounding happens only at
 * format time. This mirrors Flow formula `scale`, which rounds the final output
 * rather than each intermediate, and is what keeps this component in agreement
 * with the flow it replaces. Never round then multiply.
 *
 * Returns null-safe values; `creditsPerRequest` is null when the selected event
 * has no published rate for the chosen environment.
 */
export function computeProjection(input) {
    const {
        mode = 'token',
        environment = 'prod',
        exactTokensRaw = '',
        commonTokens = DEFAULT_TOKENS,
        promptTierKey = DEFAULT_PROMPT_TIER,
        flatEventKey = DEFAULT_FLAT_EVENT,
        actionsPerRequestRaw = '1',
        monthlyRequestsRaw = '',
        negotiatedRaw = '',
        upliftRaw = ''
    } = input || {};

    const effectiveTokens = toNumber(exactTokensRaw, toNumber(commonTokens, DEFAULT_TOKENS));
    // Blank monthly requests means 0, NOT the default 100. Blank negotiated means list.
    const monthlyRequests = toNumber(monthlyRequestsRaw, 0);
    const negotiatedPer100k = toNumber(negotiatedRaw, LIST_PRICE_PER_100K);
    // Percent-of-spend add-ons (Shield, and anything else billed as a share of
    // total spend). It scales dollars only — it never changes credits consumed.
    const upliftPercent = toNumber(upliftRaw, 0);
    const upliftFactor = 1 + upliftPercent / 100;

    const tier = promptTier(promptTierKey);
    const event = flatEvent(flatEventKey);
    const flatRate = flatEventCredits(flatEventKey, environment);
    const actionsPerRequest = toNumber(actionsPerRequestRaw, 0);

    let creditsPerRequest = null;
    let formula = '';
    let unpublished = false;

    if (mode === 'token') {
        const multiplier = tier ? tier.multiplier : 0;
        creditsPerRequest = promptCredits(effectiveTokens, multiplier);
        formula =
            `Take ${fmt.int.format(effectiveTokens)} tokens, divide by ` +
            `${fmt.int.format(TOKENS_PER_CREDIT_BLOCK)}, multiply by ${multiplier} = ` +
            `${fmt.credits2.format(creditsPerRequest)} credits each time.`;
    } else if (mode === 'flat') {
        if (flatRate === null || flatRate === undefined) {
            unpublished = true;
            formula = `Salesforce has not published a ${
                environment === 'sandbox' ? 'sandbox' : 'production'
            } price for ${
                event ? event.label : 'this event'
            } yet, so there is nothing to calculate.`;
        } else {
            creditsPerRequest = flatRate;
            formula =
                `Every ${event.label} in ${
                    environment === 'sandbox' ? 'a sandbox' : 'production'
                } costs ${flatRate} credits — always the same, no matter how big the job is.`;
        }
    } else if (mode === 'blended') {
        const multiplier = tier ? tier.multiplier : 0;
        const prompt = promptCredits(effectiveTokens, multiplier);
        if (flatRate === null || flatRate === undefined) {
            unpublished = true;
            formula = `Salesforce has not published a price for ${
                event ? event.label : 'this event'
            } in this environment yet, so there is nothing to calculate.`;
        } else {
            const actions = actionsPerRequest * flatRate;
            creditsPerRequest = prompt + actions;
            formula =
                `1 ${tier ? tier.label : ''} prompt costs ${fmt.credits2.format(prompt)}, plus ` +
                `${fmt.int.format(actionsPerRequest)} × ${event.label} costs ${fmt.credits2.format(
                    actions
                )} — ${fmt.credits2.format(creditsPerRequest)} credits each time.`;
        }
    }

    const listRate = dollarsPerCredit(LIST_PRICE_PER_100K);
    const negRate = dollarsPerCredit(negotiatedPer100k);
    const yearlyRequests = monthlyRequests * MONTHS_PER_YEAR;

    const basis = [
        { key: 'request', label: 'One request', multiplier: 1, creditDecimals: 2, dollarDecimals: 4 },
        { key: 'thousand', label: '1,000 requests', multiplier: 1000, creditDecimals: 0, dollarDecimals: 2 },
        { key: 'month', label: 'A whole month', multiplier: monthlyRequests, creditDecimals: 0, dollarDecimals: 2 },
        { key: 'year', label: 'A whole year', multiplier: yearlyRequests, creditDecimals: 0, dollarDecimals: 2 }
    ];

    const rows = basis.map((b) => {
        const credits = creditsPerRequest === null ? null : creditsPerRequest * b.multiplier;
        const listDollars = credits === null ? null : credits * listRate * upliftFactor;
        const negDollars = credits === null ? null : credits * negRate * upliftFactor;
        const savings = credits === null ? null : listDollars - negDollars;
        let qualifier = '';
        if (b.key === 'month' && monthlyRequests) {
            qualifier = `${fmt.int.format(monthlyRequests)} requests`;
        } else if (b.key === 'year' && yearlyRequests) {
            qualifier = `${fmt.int.format(yearlyRequests)} requests`;
        }
        return {
            key: b.key,
            label: b.label,
            qualifier,
            credits,
            listDollars,
            negDollars,
            savings,
            creditsText: credits === null ? '—' : formatCredits(credits, b.creditDecimals),
            listText: listDollars === null ? '—' : formatUsd(listDollars, b.dollarDecimals),
            negText: negDollars === null ? '—' : formatUsd(negDollars, b.dollarDecimals),
            savingsText: savings === null ? '—' : formatUsd(savings, b.dollarDecimals)
        };
    });

    const discount = discountPercent(negotiatedPer100k);

    return {
        mode,
        environment,
        effectiveTokens,
        monthlyRequests,
        yearlyRequests,
        creditsPerRequest,
        unpublished,
        formula,
        negotiatedPer100k,
        listPricePer100k: LIST_PRICE_PER_100K,
        listPriceText: formatUsd(LIST_PRICE_PER_100K, 2),
        negotiatedPriceText: formatUsd(negotiatedPer100k, 2),
        discountPercent: discount,
        discountText: `${fmt.pct1.format(discount)}%`,
        isDiscount: discount > 0,
        isPremium: discount < 0,
        upliftPercent,
        hasUplift: upliftPercent !== 0,
        upliftText: `${fmt.pct1.format(upliftPercent)}% uplift applied`,
        rows
    };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/*
 * Formatters are built once at module scope. Currency is hardcoded to USD
 * because the rate card is denominated in USD regardless of the org's default
 * currency — an org set to CAD must not render CA$ for a US-dollar list price.
 *
 * toFixed is deliberately avoided: (1.005).toFixed(2) === '1.00' because it
 * rounds the binary representation, and it produces no locale grouping.
 */
const LOCALE = 'en-US';

const fmt = {
    int: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }),
    credits2: new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct1: new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
};

const creditFormatters = new Map();
const usdFormatters = new Map();

export function formatCredits(value, decimals) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    if (!creditFormatters.has(decimals)) {
        creditFormatters.set(
            decimals,
            new Intl.NumberFormat(LOCALE, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            })
        );
    }
    return creditFormatters.get(decimals).format(value);
}

export function formatUsd(value, decimals) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    if (!usdFormatters.has(decimals)) {
        usdFormatters.set(
            decimals,
            new Intl.NumberFormat(LOCALE, {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            })
        );
    }
    return usdFormatters.get(decimals).format(value);
}

export function formatInt(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    return fmt.int.format(value);
}