import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSettings from '@salesforce/apex/WSM_DW_AlertSettingsController.getSettings';
import saveSettings from '@salesforce/apex/WSM_DW_AlertSettingsController.saveSettings';

/**
 * Email is never editable here. When a recipient is a Salesforce user the address
 * belongs to the User record — Apex rewrites Email__c from it on every save — so an
 * editable cell would let the two drift and the flow would mail a stale address.
 * lightning-datatable cannot vary `editable` per row, so the column is read-only for
 * everyone and the row actions provide the per-row escape hatch instead.
 */
const RECIPIENT_COLUMNS = [
    { label: 'Name', fieldName: 'name', editable: true },
    { label: 'Email', fieldName: 'emailDisplay' },
    { label: 'Salesforce user', fieldName: 'userName' },
    { label: 'Active', fieldName: 'isActive', type: 'boolean', editable: true, initialWidth: 90 },
    {
        type: 'action',
        typeAttributes: { rowActions: { fieldName: 'rowActions' } }
    }
];

const THRESHOLD_COLUMNS = [
    {
        label: 'Threshold',
        fieldName: 'value',
        type: 'number',
        editable: true,
        initialWidth: 140,
        cellAttributes: { alignment: 'right' }
    },
    { label: 'Trigger type', fieldName: 'triggerTypeLabel' },
    { label: 'Active', fieldName: 'isActive', type: 'boolean', editable: true, initialWidth: 90 },
    {
        type: 'action',
        typeAttributes: { rowActions: [{ label: 'Remove', name: 'delete' }] }
    }
];

const TRIGGER_LABELS = {
    ThresholdPercent: 'Percent consumed',
    ThresholdUnits: 'Units consumed'
};

export default class WsmAlertSettings extends LightningElement {
    recipientColumns = RECIPIENT_COLUMNS;
    thresholdColumns = THRESHOLD_COLUMNS;

    recipients = [];
    thresholds = [];
    deletedRecipientIds = [];
    deletedThresholdIds = [];
    /** Bound to both tables so a successful save clears their pending drafts. */
    emptyDrafts = [];

    activeUserCount = 0;
    activeEmailCount = 0;
    senders = [];
    senderAddress = '';
    /** { rowId, mode: 'user'|'email', label, email, userId } while a row is being edited. */
    editing = null;

    loading = true;
    saving = false;
    errorMessage = '';
    newSeq = 0;

    newName = '';
    newEmail = '';
    newUserId = null;
    newThreshold = '';

    connectedCallback() {
        this.load();
    }

    async load() {
        this.loading = true;
        this.errorMessage = '';
        try {
            this.apply(await getSettings());
        } catch (e) {
            this.errorMessage = this.messageOf(e);
        } finally {
            this.loading = false;
        }
    }

    apply(dto) {
        this.recipients = (dto.recipients || []).map((r) => this.decorate({ ...r, rowId: r.id }));
        this.thresholds = (dto.thresholds || []).map((t) => ({
            ...t,
            rowId: t.id,
            triggerTypeLabel: TRIGGER_LABELS[t.triggerType] || t.triggerType
        }));
        this.senders = dto.senders || [];
        this.senderAddress = dto.senderAddress || '';
        this.activeUserCount = dto.activeUserCount || 0;
        this.activeEmailCount = dto.activeEmailCount || 0;
        this.deletedRecipientIds = [];
        this.deletedThresholdIds = [];
        this.editing = null;
    }

    /**
     * Per-row display and actions. A user-backed row shows the user's address with a
     * lock hint and offers "Change user"; an external row offers "Change email".
     * rowActions is a per-row array because lightning-datatable resolves the action
     * list from a fieldName, which is the only way to vary behaviour by row.
     */
    decorate(row) {
        const linked = !!row.userId;
        return {
            ...row,
            emailDisplay: row.email || '—',
            rowActions: linked
                ? [
                      { label: 'Change user', name: 'changeUser' },
                      { label: 'Remove', name: 'delete' }
                  ]
                : [
                      { label: 'Change email', name: 'changeEmail' },
                      { label: 'Link a Salesforce user', name: 'changeUser' },
                      { label: 'Remove', name: 'delete' }
                  ]
        };
    }

    /* ---------------- inline row editor ---------------- */

    get isEditing() {
        return !!this.editing;
    }

    get editingUser() {
        return !!this.editing && this.editing.mode === 'user';
    }

    get editingEmail() {
        return !!this.editing && this.editing.mode === 'email';
    }

    get editorTitle() {
        if (!this.editing) {
            return '';
        }
        return this.editing.mode === 'user'
            ? `Salesforce user for ${this.editing.label}`
            : `Email for ${this.editing.label}`;
    }

    startEdit(row, mode) {
        this.errorMessage = '';
        this.editing = {
            rowId: row.rowId,
            mode,
            label: row.name || row.email || 'this recipient',
            email: mode === 'email' ? row.email || '' : '',
            userId: null
        };
    }

    handleEditorUserPicked(event) {
        this.editing = {
            ...this.editing,
            userId: event.detail ? event.detail.recordId : null
        };
    }

    handleEditorEmail(event) {
        this.editing = { ...this.editing, email: event.target.value };
    }

    handleEditorCancel() {
        this.editing = null;
    }

    handleEditorSave() {
        const edit = this.editing;
        if (!edit) {
            return;
        }
        if (edit.mode === 'user' && !edit.userId) {
            this.errorMessage = 'Pick a Salesforce user, or cancel.';
            return;
        }
        if (edit.mode === 'email' && !edit.email) {
            this.errorMessage = 'Enter an email address, or cancel.';
            return;
        }
        this.recipients = this.recipients.map((r) => {
            if (this.rowKey(r) !== edit.rowId) {
                return r;
            }
            return this.decorate(
                edit.mode === 'user'
                    ? { ...r, userId: edit.userId, userName: 'Pending save', emailLocked: true }
                    : { ...r, email: edit.email, userId: null, userName: null, emailLocked: false }
            );
        });
        this.editing = null;
        this.persist();
    }

    /* ---------------- sender ---------------- */

    get senderOptions() {
        return this.senders.map((s) => ({
            label: s.allProfiles
                ? `${s.label} — ${s.address}`
                : `${s.label} — ${s.address} (not enabled for all profiles)`,
            value: s.address
        }));
    }

    get hasSenders() {
        return this.senders.length > 0;
    }

    get noSenders() {
        return !this.loading && this.senders.length === 0;
    }

    get senderChosen() {
        return !!this.senderAddress;
    }

    /** An address that exists but is not all-profiles can fail when the scheduled
     *  flow sends as the Automated Process User. */
    get senderRestricted() {
        const match = this.senders.find((s) => s.address === this.senderAddress);
        return !!match && !match.allProfiles;
    }

    get showNoSenderWarning() {
        return !this.loading && this.hasSenders && !this.senderChosen && this.activeEmailCount > 0;
    }

    handleSenderChange(event) {
        this.senderAddress = event.detail.value;
        this.persist();
    }

    /* ---------------- derived ---------------- */

    get hasError() {
        return !!this.errorMessage;
    }

    get busy() {
        return this.loading || this.saving;
    }

    get userPickerFilter() {
        return { criteria: [{ fieldPath: 'IsActive', operator: 'eq', value: true }] };
    }

    get audienceSummary() {
        const users = `${this.activeUserCount} in-app notification${
            this.activeUserCount === 1 ? '' : 's'
        }`;
        const emails = `${this.activeEmailCount} email${this.activeEmailCount === 1 ? '' : 's'}`;
        return `${users} · ${emails}`;
    }

    get showAdminFallbackWarning() {
        return !this.loading && this.activeUserCount === 0;
    }

    get canAddRecipient() {
        return !!(this.newEmail || this.newUserId);
    }

    get addRecipientDisabled() {
        return !this.canAddRecipient || this.busy;
    }

    /** Picking a user in the add row supplies the address, so the email box goes dead. */
    get addEmailDisabled() {
        return !!this.newUserId;
    }

    /* ---------------- handlers ---------------- */

    handleNewName(event) {
        this.newName = event.target.value;
    }

    handleNewEmail(event) {
        this.newEmail = event.target.value;
    }

    handleUserPicked(event) {
        this.newUserId = event.detail ? event.detail.recordId : null;
    }

    handleNewThreshold(event) {
        this.newThreshold = event.target.value;
    }

    handleAddRecipient() {
        if (!this.canAddRecipient) {
            return;
        }
        this.newSeq += 1;
        this.recipients = [
            ...this.recipients,
            this.decorate({
                id: null,
                rowId: `new-r-${this.newSeq}`,
                name: this.newName || this.newEmail || 'New recipient',
                // A linked user's address comes from the User record, so anything
                // typed in the email box is dropped rather than silently stored.
                email: this.newUserId ? null : this.newEmail || null,
                userId: this.newUserId || null,
                userName: this.newUserId ? 'Pending save' : null,
                emailLocked: !!this.newUserId,
                isActive: true
            })
        ];
        this.newName = '';
        this.newEmail = '';
        this.newUserId = null;
        const picker = this.template.querySelector('lightning-record-picker');
        if (picker) {
            picker.clearSelection();
        }
        // Save immediately. The datatable's own Save button only appears for inline
        // edits, so an added row would otherwise sit unsaved and vanish on refresh.
        this.persist();
    }

    handleAddThreshold() {
        const value = Number(String(this.newThreshold).trim());
        if (!Number.isFinite(value) || value <= 0 || value > 100) {
            this.errorMessage = 'Enter a percent threshold between 1 and 100.';
            return;
        }
        this.errorMessage = '';
        this.newSeq += 1;
        this.thresholds = [
            ...this.thresholds,
            {
                id: null,
                rowId: `new-t-${this.newSeq}`,
                value,
                triggerType: 'ThresholdPercent',
                triggerTypeLabel: TRIGGER_LABELS.ThresholdPercent,
                isActive: true
            }
        ];
        this.newThreshold = '';
        this.persist();
    }

    handleRecipientRowAction(event) {
        const row = event.detail.row;
        const action = event.detail.action.name;
        if (action === 'changeUser') {
            this.startEdit(row, 'user');
            return;
        }
        if (action === 'changeEmail') {
            this.startEdit(row, 'email');
            return;
        }
        if (action !== 'delete') {
            return;
        }
        if (row.id) {
            this.deletedRecipientIds = [...this.deletedRecipientIds, row.id];
        }
        this.recipients = this.recipients.filter((r) => this.rowKey(r) !== this.rowKey(row));
        this.persist();
    }

    handleThresholdRowAction(event) {
        const row = event.detail.row;
        if (event.detail.action.name !== 'delete') {
            return;
        }
        if (row.id) {
            this.deletedThresholdIds = [...this.deletedThresholdIds, row.id];
        }
        this.thresholds = this.thresholds.filter((t) => this.rowKey(t) !== this.rowKey(row));
        this.persist();
    }

    handleRecipientSave(event) {
        this.recipients = this.merge(this.recipients, event.detail.draftValues);
        this.persist();
    }

    handleThresholdSave(event) {
        this.thresholds = this.merge(this.thresholds, event.detail.draftValues);
        this.persist();
    }

    merge(rows, drafts) {
        const byKey = new Map((drafts || []).map((d) => [d.id, d]));
        return rows.map((row) => {
            const draft = byKey.get(this.rowKey(row));
            return draft ? { ...row, ...draft, id: row.id } : row;
        });
    }

    /** rowId is the key-field: the Salesforce Id once saved, a temp key before that.
     *  Draft values come back keyed by the same value. */
    rowKey(row) {
        return row.rowId;
    }

    async persist() {
        this.saving = true;
        this.errorMessage = '';
        try {
            const dto = await saveSettings({
                recipientsJson: JSON.stringify(
                    this.recipients.map((r) => ({
                        id: r.id,
                        name: r.name,
                        email: r.email,
                        userId: r.userId,
                        isActive: r.isActive === true || r.isActive === 'true'
                    }))
                ),
                thresholdsJson: JSON.stringify(
                    this.thresholds.map((t) => ({
                        id: t.id,
                        value: Number(t.value),
                        triggerType: t.triggerType,
                        isActive: t.isActive === true || t.isActive === 'true'
                    }))
                ),
                deletedRecipientIdsJson: JSON.stringify(this.deletedRecipientIds),
                deletedThresholdIdsJson: JSON.stringify(this.deletedThresholdIds),
                senderAddress: this.senderAddress || null
            });
            this.apply(dto);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Alert settings saved',
                    message: 'The scheduled flow will use these on its next run.',
                    variant: 'success'
                })
            );
        } catch (e) {
            this.errorMessage = this.messageOf(e);
        } finally {
            this.saving = false;
        }
    }

    handleRefresh() {
        this.load();
    }

    messageOf(error) {
        if (!error) {
            return 'Unknown error.';
        }
        if (error.body && error.body.message) {
            return error.body.message;
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }
}