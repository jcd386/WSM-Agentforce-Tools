import { LightningElement, api } from 'lwc';

/**
 * Presentational only. Renders the projection built by wsmAgentforceRateCard.
 * Holds no state and derives nothing beyond display classes.
 */
export default class WsmCreditResultGrid extends LightningElement {
    @api model;

    get rows() {
        return this.model && this.model.rows ? this.model.rows : [];
    }

    get hasResult() {
        return !!(this.model && this.model.creditsPerRequest !== null);
    }

    get discountClass() {
        if (!this.model) {
            return 'wsm-price-badge';
        }
        if (this.model.isDiscount) {
            return 'wsm-price-badge wsm-price-badge_good';
        }
        if (this.model.isPremium) {
            return 'wsm-price-badge wsm-price-badge_bad';
        }
        return 'wsm-price-badge';
    }

    get discountCaption() {
        if (!this.model) {
            return '';
        }
        if (this.model.isPremium) {
            return `${this.model.discountText.replace('-', '')} above list price`;
        }
        if (this.model.isDiscount) {
            return `${this.model.discountText} below list price`;
        }
        return 'At list price';
    }
}
