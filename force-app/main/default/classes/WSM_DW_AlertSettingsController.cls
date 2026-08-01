/**
 * Backs the Digital Wallet Alerts tab on the WSM Agentforce Tools page.
 *
 * Save is deliberately atomic. The scheduled flow WSM_Agentforce_Credit_Alerts
 * reads this configuration unattended at midnight, so a half-applied save would
 * leave alerting in a state nobody chose. One savepoint covers every insert,
 * update and delete across both objects.
 *
 * Set-level rules (at least one active threshold, no duplicate active
 * thresholds, keep the 100 percent record) cannot be expressed as validation
 * rules, so they are enforced here.
 */
public with sharing class WSM_DW_AlertSettingsController {
    private static final String TYPE_PERCENT = 'ThresholdPercent';

    public class RecipientDTO {
        @AuraEnabled public String id { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public String email { get; set; }
        @AuraEnabled public String userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        /** True when the email comes from the linked User and must not be edited. */
        @AuraEnabled public Boolean emailLocked { get; set; }
        @AuraEnabled public Boolean isActive { get; set; }
    }

    public class ThresholdDTO {
        @AuraEnabled public String id { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public Decimal value { get; set; }
        @AuraEnabled public String triggerType { get; set; }
        @AuraEnabled public Boolean isActive { get; set; }
    }

    /** A verified Organization-Wide Email Address the alert emails can be sent from. */
    public class SenderDTO {
        @AuraEnabled public String address { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public Boolean allProfiles { get; set; }
    }

    public class SettingsDTO {
        @AuraEnabled public List<RecipientDTO> recipients { get; set; }
        @AuraEnabled public List<ThresholdDTO> thresholds { get; set; }
        @AuraEnabled public List<SenderDTO> senders { get; set; }
        @AuraEnabled public String senderAddress { get; set; }
        @AuraEnabled public Integer activeUserCount { get; set; }
        @AuraEnabled public Integer activeEmailCount { get; set; }

        public SettingsDTO() {
            this.recipients = new List<RecipientDTO>();
            this.thresholds = new List<ThresholdDTO>();
            this.senders = new List<SenderDTO>();
            this.activeUserCount = 0;
            this.activeEmailCount = 0;
        }
    }

    /**
     * Deliberately NOT cacheable. This is called imperatively by the Refresh
     * button, and a cacheable method is served from the client-side Lightning
     * Data Service cache — so after a save, Refresh would hand back the stale
     * pre-save snapshot and appear to lose the row that was just added. There is
     * nothing to gain from caching an admin settings screen.
     */
    @AuraEnabled
    public static SettingsDTO getSettings() {
        return loadSettings();
    }

    /**
     * Inputs arrive as JSON strings rather than typed Apex parameters. Passing a
     * custom class as an @AuraEnabled input has produced gacks in namespaced
     * orgs, and a JSON string sidesteps the whole class of problem.
     */
    @AuraEnabled
    public static SettingsDTO saveSettings(
        String recipientsJson,
        String thresholdsJson,
        String deletedRecipientIdsJson,
        String deletedThresholdIdsJson,
        String senderAddress
    ) {
        List<RecipientDTO> recipients = (List<RecipientDTO>) JSON.deserialize(
            String.isBlank(recipientsJson) ? '[]' : recipientsJson,
            List<RecipientDTO>.class
        );
        List<ThresholdDTO> thresholds = (List<ThresholdDTO>) JSON.deserialize(
            String.isBlank(thresholdsJson) ? '[]' : thresholdsJson,
            List<ThresholdDTO>.class
        );
        List<Id> deletedRecipientIds = parseIds(deletedRecipientIdsJson);
        List<Id> deletedThresholdIds = parseIds(deletedThresholdIdsJson);

        validate(recipients, thresholds);
        validateSender(senderAddress);

        Savepoint sp = Database.setSavepoint();
        try {
            applyThresholds(thresholds, deletedThresholdIds);
            applyRecipients(recipients, deletedRecipientIds);
            applySender(senderAddress);
        } catch (Exception e) {
            Database.rollback(sp);
            throw error(friendly(e));
        }
        return loadSettings();
    }

    /* ---------------- internals ---------------- */

    private static void validate(List<RecipientDTO> recipients, List<ThresholdDTO> thresholds) {
        Integer activeThresholds = 0;
        Boolean hasActiveHundred = false;
        Set<String> seen = new Set<String>();

        for (ThresholdDTO t : thresholds) {
            if (t.value == null || String.isBlank(t.triggerType)) {
                throw error('Every threshold needs a value and a trigger type.');
            }
            if (t.isActive != true) {
                continue;
            }
            activeThresholds++;
            String key = t.triggerType + '|' + t.value.setScale(2).toPlainString();
            if (seen.contains(key)) {
                throw error('Two active thresholds share the same value and trigger type (' +
                    t.value.stripTrailingZeros().toPlainString() + '). Remove one.'
                );
            }
            seen.add(key);
            if (t.triggerType == TYPE_PERCENT && t.value == 100) {
                hasActiveHundred = true;
            }
        }

        if (activeThresholds == 0) {
            throw error('Keep at least one active threshold, otherwise no alert can ever fire.'
            );
        }
        if (!hasActiveHundred) {
            throw error('The 100% percent threshold must stay active. It is the only trigger for prepaid ' +
                'overage alerts, and removing it silently stops them.'
            );
        }

        Integer activeRecipients = 0;
        for (RecipientDTO r : recipients) {
            if (r.isActive != true) {
                continue;
            }
            if (String.isBlank(r.email) && String.isBlank(r.userId)) {
                throw error('Recipient "' + (String.isBlank(r.name) ? 'unnamed' : r.name) +
                    '" has neither an email address nor a Salesforce user, so it could never be alerted.'
                );
            }
            activeRecipients++;
        }
        if (activeRecipients == 0) {
            throw error('Keep at least one active recipient. With none, alerts fall back to every active ' +
                'system administrator.'
            );
        }
    }

    /**
     * A blank sender is allowed and simply means no alert emails go out — the flow
     * gates on it, and in-app notifications are unaffected. A non-blank sender must
     * be a real verified org-wide address, otherwise the send would fail silently
     * at midnight through the flow's fault path.
     */
    private static void validateSender(String senderAddress) {
        if (String.isBlank(senderAddress)) {
            return;
        }
        for (SenderDTO s : availableSenders()) {
            if (s.address.equalsIgnoreCase(senderAddress.trim())) {
                return;
            }
        }
        throw error(
            '"' + senderAddress + '" is not a verified organization-wide email address in this org. ' +
            'Add and verify it under Setup, Organization-Wide Addresses, then pick it here.'
        );
    }

    private static void applySender(String senderAddress) {
        WSM_DW_Alert_Config__c cfg = WSM_DW_Alert_Config__c.getOrgDefaults();
        if (cfg == null) {
            cfg = new WSM_DW_Alert_Config__c();
        }
        if (cfg.Id == null) {
            cfg.SetupOwnerId = UserInfo.getOrganizationId();
        }
        cfg.Sender_Address__c = String.isBlank(senderAddress) ? null : senderAddress.trim();
        upsert as user cfg;
    }

    private static List<SenderDTO> availableSenders() {
        List<SenderDTO> out = new List<SenderDTO>();
        for (OrgWideEmailAddress o : [
            SELECT Address, DisplayName, IsAllowAllProfiles
            FROM OrgWideEmailAddress
            WITH USER_MODE
            ORDER BY DisplayName
            LIMIT 200
        ]) {
            SenderDTO s = new SenderDTO();
            s.address = o.Address;
            s.label = o.DisplayName;
            s.allProfiles = o.IsAllowAllProfiles;
            out.add(s);
        }
        return out;
    }

    private static void applyThresholds(List<ThresholdDTO> thresholds, List<Id> deletedIds) {
        List<WSM_DW_Alert_Threshold__c> toUpsert = new List<WSM_DW_Alert_Threshold__c>();
        for (ThresholdDTO t : thresholds) {
            WSM_DW_Alert_Threshold__c rec = new WSM_DW_Alert_Threshold__c(
                Threshold_Value__c = t.value,
                Trigger_Type__c = t.triggerType,
                Is_Active__c = t.isActive == true
            );
            if (String.isNotBlank(t.id)) {
                rec.Id = (Id) t.id;
            }
            toUpsert.add(rec);
        }
        if (!toUpsert.isEmpty()) {
            upsert as user toUpsert;
        }
        if (!deletedIds.isEmpty()) {
            List<WSM_DW_Alert_Threshold__c> toDelete = [
                SELECT Id
                FROM WSM_DW_Alert_Threshold__c
                WHERE Id IN :deletedIds
                WITH USER_MODE
            ];
            if (!toDelete.isEmpty()) {
                delete as user toDelete;
            }
        }
    }

    /**
     * When a recipient points at a Salesforce user, Email__c is left NULL and the
     * address comes from the Effective_Email__c formula, which reads User__r.Email.
     * Nothing is copied, so a user who changes their Salesforce address is picked up
     * immediately with nothing to re-save and no chance of the two drifting apart.
     * Name is still filled from the user when left blank.
     */
    private static void applyRecipients(List<RecipientDTO> recipients, List<Id> deletedIds) {
        Set<Id> userIds = new Set<Id>();
        for (RecipientDTO r : recipients) {
            if (String.isNotBlank(r.userId)) {
                userIds.add((Id) r.userId);
            }
        }
        Map<Id, User> usersById = userIds.isEmpty()
            ? new Map<Id, User>()
            : new Map<Id, User>([
                SELECT Id, Name, Email FROM User WHERE Id IN :userIds WITH USER_MODE
            ]);

        List<WSM_DW_Alert_Recipient__c> toUpsert = new List<WSM_DW_Alert_Recipient__c>();
        for (RecipientDTO r : recipients) {
            Id uid = String.isBlank(r.userId) ? null : (Id) r.userId;
            User u = uid == null ? null : usersById.get(uid);
            if (uid != null && u == null) {
                throw error('That Salesforce user no longer exists or is not visible to you.');
            }

            // Null when a user is linked: the formula supplies the address, and a
            // leftover stored value would be dead weight that looks authoritative.
            String email = u != null
                ? null
                : (String.isBlank(r.email) ? null : r.email.trim());
            String label = String.isNotBlank(r.name)
                ? r.name
                : (u != null ? u.Name : email);

            WSM_DW_Alert_Recipient__c rec = new WSM_DW_Alert_Recipient__c(
                Name = String.isBlank(label) ? 'Recipient' : label.left(80),
                Email__c = email,
                User__c = uid,
                Is_Active__c = r.isActive == true
            );
            if (String.isNotBlank(r.id)) {
                rec.Id = (Id) r.id;
            }
            toUpsert.add(rec);
        }
        if (!toUpsert.isEmpty()) {
            upsert as user toUpsert;
        }
        if (!deletedIds.isEmpty()) {
            List<WSM_DW_Alert_Recipient__c> toDelete = [
                SELECT Id
                FROM WSM_DW_Alert_Recipient__c
                WHERE Id IN :deletedIds
                WITH USER_MODE
            ];
            if (!toDelete.isEmpty()) {
                delete as user toDelete;
            }
        }
    }

    private static SettingsDTO loadSettings() {
        SettingsDTO dto = new SettingsDTO();

        dto.senders = availableSenders();
        WSM_DW_Alert_Config__c cfg = WSM_DW_Alert_Config__c.getOrgDefaults();
        dto.senderAddress = cfg == null ? null : cfg.Sender_Address__c;

        for (WSM_DW_Alert_Recipient__c r : [
            SELECT Id, Name, Email__c, Effective_Email__c, User__c, User__r.Name, Is_Active__c
            FROM WSM_DW_Alert_Recipient__c
            WITH USER_MODE
            ORDER BY Is_Active__c DESC, Name
            LIMIT 500
        ]) {
            // Effective_Email__c is a formula over User__r.Email, so it is always
            // current — there is no stored copy to go stale.
            String effectiveEmail = r.Effective_Email__c;

            RecipientDTO d = new RecipientDTO();
            d.id = r.Id;
            d.name = r.Name;
            d.email = effectiveEmail;
            d.userId = r.User__c;
            d.userName = r.User__c == null ? null : r.User__r.Name;
            d.emailLocked = r.User__c != null;
            d.isActive = r.Is_Active__c;
            dto.recipients.add(d);
            if (r.Is_Active__c) {
                if (r.User__c != null) {
                    dto.activeUserCount++;
                }
                if (String.isNotBlank(effectiveEmail)) {
                    dto.activeEmailCount++;
                }
            }
        }

        for (WSM_DW_Alert_Threshold__c t : [
            SELECT Id, Name, Threshold_Value__c, Trigger_Type__c, Is_Active__c
            FROM WSM_DW_Alert_Threshold__c
            WITH USER_MODE
            ORDER BY Trigger_Type__c, Threshold_Value__c
            LIMIT 500
        ]) {
            ThresholdDTO d = new ThresholdDTO();
            d.id = t.Id;
            d.name = t.Name;
            d.value = t.Threshold_Value__c;
            d.triggerType = t.Trigger_Type__c;
            d.isActive = t.Is_Active__c;
            dto.thresholds.add(d);
        }

        return dto;
    }

    private static List<Id> parseIds(String rawJson) {
        List<Id> out = new List<Id>();
        if (String.isBlank(rawJson)) {
            return out;
        }
        for (Object o : (List<Object>) JSON.deserializeUntyped(rawJson)) {
            String s = String.valueOf(o);
            if (String.isNotBlank(s)) {
                out.add((Id) s);
            }
        }
        return out;
    }

    /** Surface the validation-rule text rather than a raw DML dump. */

    /**
     * AuraHandledException swallows its message unless setMessage is also called,
     * which makes both test failures and LWC toasts read "Script-thrown exception".
     */
    private static AuraHandledException error(String msg) {
        AuraHandledException e = new AuraHandledException(msg);
        e.setMessage(msg);
        return e;
    }

    private static String friendly(Exception e) {
        String msg = e.getMessage();
        if (msg != null && msg.contains('FIELD_CUSTOM_VALIDATION_EXCEPTION')) {
            Integer start = msg.indexOf('FIELD_CUSTOM_VALIDATION_EXCEPTION, ');
            if (start >= 0) {
                String tail = msg.substring(start + 35);
                Integer stop = tail.indexOf(': [');
                return stop > 0 ? tail.substring(0, stop) : tail;
            }
        }
        return msg;
    }
}