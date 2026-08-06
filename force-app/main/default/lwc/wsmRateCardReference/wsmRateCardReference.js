import { LightningElement } from 'lwc';
import {
    RATE_CARD_VERSION,
    RATE_CARD_SOURCE_URL,
    LLM_SUPPORT_URL,
    TOKENS_PER_CREDIT_BLOCK,
    LIST_PRICE_PER_100K,
    PROMPT_TIERS,
    FLAT_EVENTS,
    UNPRICED,
    DATA_360_TIERS,
    DATA_360_RATES,
    SPEECH_RATES,
    formatInt,
    formatUsd
} from 'c/wsmAgentforceRateCard';

const NOT_PUBLISHED = 'Not published';

/**
 * Reference tables. Nothing here is calculated — these are transcribed rates
 * shown so a quote can be sanity-checked without leaving the page.
 *
 * No @track anywhere: LWS sanitizes URL-like strings out of tracked arrays, and
 * this component holds doc links.
 */
export default class WsmRateCardReference extends LightningElement {
    expanded = false;

    version = RATE_CARD_VERSION;
    sourceUrl = RATE_CARD_SOURCE_URL;
    llmUrl = LLM_SUPPORT_URL;
    tokenBlock = formatInt(TOKENS_PER_CREDIT_BLOCK);
    listPrice = formatUsd(LIST_PRICE_PER_100K, 2);
    data360Tiers = DATA_360_TIERS;

    get toggleLabel() {
        return this.expanded ? 'Hide the full price list' : 'Show the full price list';
    }

    get toggleIcon() {
        return this.expanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get promptRows() {
        return PROMPT_TIERS.map((t) => ({
            key: t.key,
            label: t.label,
            note: t.note,
            multiplier: `${t.multiplier}×`
        }));
    }

    get flatRows() {
        return FLAT_EVENTS.map((e) => ({
            key: e.key,
            label: e.label,
            prod: `${e.prod} cr`,
            sandbox: e.sandbox === null ? NOT_PUBLISHED : `${e.sandbox} cr`,
            sandboxClass:
                e.sandbox === null ? 'wsm-num wsm-num_muted' : 'wsm-num'
        }));
    }

    get unpricedRows() {
        return UNPRICED.map((u) => ({ key: u.key, label: u.label, note: u.note }));
    }

    get data360Rows() {
        return DATA_360_RATES.map((r, i) => ({
            key: `d360-${i}`,
            label: r.label,
            unit: r.unit,
            cells: r.rates.map((v, j) => ({ key: `d360-${i}-${j}`, value: formatInt(v) }))
        }));
    }

    get data360HeaderCells() {
        return DATA_360_TIERS.map((t, i) => ({ key: `tier-${i}`, label: t }));
    }

    get speechRows() {
        return SPEECH_RATES.map((r, i) => ({
            key: `sp-${i}`,
            label: r.label,
            unit: r.unit,
            rate: `${formatInt(r.rate)} cr`
        }));
    }

    handleToggle() {
        this.expanded = !this.expanded;
    }
}