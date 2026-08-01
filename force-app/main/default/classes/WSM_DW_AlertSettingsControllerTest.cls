@IsTest
private class WSM_DW_AlertSettingsControllerTest {
    private static final String TYPE_PERCENT = 'ThresholdPercent';
    private static final String EMPTY_LIST = '[]';

    @TestSetup
    static void setup() {
        insert new List<WSM_DW_Alert_Threshold__c>{
            new WSM_DW_Alert_Threshold__c(
                Threshold_Value__c = 50,
                Trigger_Type__c = TYPE_PERCENT,
                Is_Active__c = true
            ),
            new WSM_DW_Alert_Threshold__c(
                Threshold_Value__c = 100,
                Trigger_Type__c = TYPE_PERCENT,
                Is_Active__c = true
            )
        };
        insert new WSM_DW_Alert_Recipient__c(
            Name = 'Ops Inbox',
            Email__c = 'ops@example.com',
            Is_Active__c = true
        );
    }

    /* ---------------- builders ---------------- */

    private static Map<String, Object> threshold(Id recId, Decimal value, Boolean isActive) {
        return new Map<String, Object>{
            'id' => recId,
            'value' => value,
            'triggerType' => TYPE_PERCENT,
            'isActive' => isActive
        };
    }

    private static String validThresholds() {
        return JSON.serialize(new List<Map<String, Object>>{
            threshold(null, 50, true),
            threshold(null, 100, true)
        });
    }

    private static String recipients(String email, Id userId, Boolean isActive) {
        return JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'name' => 'Ops Inbox',
                'email' => email,
                'userId' => userId,
                'isActive' => isActive
            }
        });
    }

    private static String validRecipients() {
        return recipients('ops@example.com', null, true);
    }

    /** Runs saveSettings and returns the error message, or '' when it succeeded. */
    private static String saveExpectingError(String recipientsJson, String thresholdsJson) {
        return saveExpectingError(recipientsJson, thresholdsJson, null);
    }

    private static String saveExpectingError(
        String recipientsJson,
        String thresholdsJson,
        String senderAddress
    ) {
        try {
            WSM_DW_AlertSettingsController.saveSettings(
                recipientsJson,
                thresholdsJson,
                EMPTY_LIST,
                EMPTY_LIST,
                senderAddress
            );
            return '';
        } catch (Exception e) {
            return e.getMessage();
        }
    }

    /* ---------------- tests ---------------- */

    @IsTest
    static void getSettingsReturnsSeededConfig() {
        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.getSettings();
        Test.stopTest();

        System.assertEquals(2, dto.thresholds.size(), 'Both seeded thresholds should load');
        System.assertEquals(1, dto.recipients.size(), 'The seeded recipient should load');
        System.assertEquals(1, dto.activeEmailCount, 'Seeded recipient has an email');
        System.assertEquals(
            0,
            dto.activeUserCount,
            'Seeded recipient has no user, which is what drives the admin-fallback warning'
        );
    }

    @IsTest
    static void saveInsertsUpdatesAndDeletesInOneTransaction() {
        WSM_DW_Alert_Threshold__c fifty = [
            SELECT Id FROM WSM_DW_Alert_Threshold__c WHERE Threshold_Value__c = 50 LIMIT 1
        ];
        WSM_DW_Alert_Threshold__c hundred = [
            SELECT Id FROM WSM_DW_Alert_Threshold__c WHERE Threshold_Value__c = 100 LIMIT 1
        ];
        WSM_DW_Alert_Recipient__c seeded = [SELECT Id FROM WSM_DW_Alert_Recipient__c LIMIT 1];

        String thresholdsJson = JSON.serialize(new List<Map<String, Object>>{
            threshold(fifty.Id, 60, true),
            threshold(hundred.Id, 100, true),
            threshold(null, 90, true)
        });
        String recipientsJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'id' => seeded.Id,
                'name' => 'Ops Inbox',
                'email' => 'ops@example.com',
                'userId' => UserInfo.getUserId(),
                'isActive' => true
            },
            new Map<String, Object>{
                'name' => 'Finance',
                'email' => 'finance@example.com',
                'userId' => null,
                'isActive' => true
            }
        });

        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                recipientsJson,
                thresholdsJson,
                EMPTY_LIST,
                EMPTY_LIST,
                null
            );
        Test.stopTest();

        // intValue() rather than the raw Decimal: Set<Decimal> is scale-sensitive in
        // Apex, so a stored 60.00 does not match a literal 60.
        Set<Integer> values = new Set<Integer>();
        for (WSM_DW_AlertSettingsController.ThresholdDTO t : dto.thresholds) {
            values.add(t.value.intValue());
        }
        System.assertEquals(3, dto.thresholds.size(), 'Expected 60, 90 and 100');
        System.assert(values.contains(60), 'The edited threshold should now be 60');
        System.assert(values.contains(90), 'The inserted threshold should exist');
        System.assert(!values.contains(50), 'The original 50 should have been updated away');
        System.assertEquals(2, dto.recipients.size(), 'One edited plus one inserted recipient');
        System.assertEquals(1, dto.activeUserCount, 'One recipient now carries a user');
        System.assertEquals(2, dto.activeEmailCount, 'Both recipients carry an email');
    }

    @IsTest
    static void deletesRemovedRows() {
        WSM_DW_Alert_Threshold__c fifty = [
            SELECT Id FROM WSM_DW_Alert_Threshold__c WHERE Threshold_Value__c = 50 LIMIT 1
        ];
        WSM_DW_Alert_Threshold__c hundred = [
            SELECT Id FROM WSM_DW_Alert_Threshold__c WHERE Threshold_Value__c = 100 LIMIT 1
        ];

        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                validRecipients(),
                JSON.serialize(new List<Map<String, Object>>{ threshold(hundred.Id, 100, true) }),
                EMPTY_LIST,
                JSON.serialize(new List<Id>{ fifty.Id }),
                null
            );
        Test.stopTest();

        System.assertEquals(1, dto.thresholds.size(), 'Only the 100 threshold should remain');
        System.assertEquals(
            0,
            [SELECT COUNT() FROM WSM_DW_Alert_Threshold__c WHERE Id = :fifty.Id],
            'The removed threshold should be gone from the database'
        );
    }

    @IsTest
    static void rejectsRemovingTheHundredPercentThreshold() {
        String err = saveExpectingError(
            validRecipients(),
            JSON.serialize(new List<Map<String, Object>>{ threshold(null, 50, true) })
        );
        System.assert(
            err.contains('100%'),
            'Dropping the 100% threshold must be rejected by name. Got: ' + err
        );
    }

    @IsTest
    static void rejectsDeactivatingTheHundredPercentThreshold() {
        String err = saveExpectingError(
            validRecipients(),
            JSON.serialize(new List<Map<String, Object>>{
                threshold(null, 50, true),
                threshold(null, 100, false)
            })
        );
        System.assert(
            err.contains('100%'),
            'An inactive 100% threshold is the same silent failure. Got: ' + err
        );
    }

    @IsTest
    static void rejectsDuplicateActiveThresholds() {
        String err = saveExpectingError(
            validRecipients(),
            JSON.serialize(new List<Map<String, Object>>{
                threshold(null, 50, true),
                threshold(null, 50, true),
                threshold(null, 100, true)
            })
        );
        System.assert(
            err.contains('same value'),
            'Duplicate active thresholds must be rejected. Got: ' + err
        );
    }

    @IsTest
    static void rejectsThresholdWithNoValue() {
        String err = saveExpectingError(
            validRecipients(),
            JSON.serialize(new List<Map<String, Object>>{
                new Map<String, Object>{ 'triggerType' => TYPE_PERCENT, 'isActive' => true }
            })
        );
        System.assert(err.contains('needs a value'), 'Got: ' + err);
    }

    @IsTest
    static void rejectsRecipientWithNeitherEmailNorUser() {
        String err = saveExpectingError(recipients(null, null, true), validThresholds());
        System.assert(
            err.contains('neither an email address nor a Salesforce user'),
            'An unreachable recipient must be rejected. Got: ' + err
        );
    }

    @IsTest
    static void rejectsEmptyRecipientList() {
        String err = saveExpectingError(EMPTY_LIST, validThresholds());
        System.assert(
            err.contains('at least one active recipient'),
            'Saving with no active recipient must be rejected. Got: ' + err
        );
    }

    @IsTest
    static void rejectsEmptyThresholdList() {
        String err = saveExpectingError(validRecipients(), EMPTY_LIST);
        System.assert(
            err.contains('at least one active threshold'),
            'Saving with no active threshold must be rejected. Got: ' + err
        );
    }

    @IsTest
    static void surfacesValidationRuleTextOnDmlFailure() {
        // 150 passes the Apex set-level checks but trips the object validation rule.
        // This exercises the savepoint rollback and the friendly() message extraction.
        String err = saveExpectingError(
            validRecipients(),
            JSON.serialize(new List<Map<String, Object>>{
                threshold(null, 150, true),
                threshold(null, 100, true)
            })
        );
        System.assert(
            err.contains('between 1 and 100'),
            'The validation rule text should reach the user, not a raw DML dump. Got: ' + err
        );
        System.assertEquals(
            2,
            [SELECT COUNT() FROM WSM_DW_Alert_Threshold__c],
            'The savepoint should have rolled back every change from the failed save'
        );
    }

    @IsTest
    static void userBackedRecipientTakesTheUsersEmail() {
        User me = [SELECT Id, Email FROM User WHERE Id = :UserInfo.getUserId()];
        String recipientsJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'name' => 'Linked',
                // Deliberately wrong: linking a user must win over anything typed,
                // otherwise the stored copy drifts and the flow mails a dead address.
                'email' => 'typed-by-hand@example.com',
                'userId' => me.Id,
                'isActive' => true
            }
        });

        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                recipientsJson, validThresholds(), EMPTY_LIST, EMPTY_LIST, null
            );
        Test.stopTest();

        WSM_DW_AlertSettingsController.RecipientDTO linked = null;
        for (WSM_DW_AlertSettingsController.RecipientDTO r : dto.recipients) {
            if (r.userId == me.Id) {
                linked = r;
            }
        }
        System.assertNotEquals(null, linked, 'The linked recipient should come back');
        System.assertEquals(
            me.Email,
            linked.email,
            'Email must come from the User record, not the typed value'
        );
        System.assertEquals(true, linked.emailLocked, 'A user-backed row is not editable');

        WSM_DW_Alert_Recipient__c stored = [
            SELECT Email__c, Effective_Email__c
            FROM WSM_DW_Alert_Recipient__c
            WHERE User__c = :me.Id
            LIMIT 1
        ];
        System.assertEquals(
            null,
            stored.Email__c,
            'Nothing is copied into Email__c — a stored copy could drift from the User record'
        );
        System.assertEquals(
            me.Email,
            stored.Effective_Email__c,
            'The formula derives the address from User__r.Email, which is what the flow reads'
        );
    }

    @IsTest
    static void externalRecipientKeepsItsTypedEmail() {
        WSM_DW_Alert_Recipient__c seeded = [SELECT Id FROM WSM_DW_Alert_Recipient__c LIMIT 1];
        String recipientsJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'id' => seeded.Id,
                'name' => 'Ops Inbox',
                'email' => 'newops@example.com',
                'userId' => null,
                'isActive' => true
            }
        });

        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                recipientsJson, validThresholds(), EMPTY_LIST, EMPTY_LIST, null
            );
        Test.stopTest();

        System.assertEquals('newops@example.com', dto.recipients[0].email, 'Typed email should stick');
        System.assertEquals(
            false,
            dto.recipients[0].emailLocked,
            'With no user linked the address stays editable'
        );
        System.assertEquals(
            'newops@example.com',
            [
                SELECT Effective_Email__c FROM WSM_DW_Alert_Recipient__c WHERE Id = :seeded.Id
            ].Effective_Email__c,
            'With no user the formula falls back to the typed address'
        );
    }

    @IsTest
    static void linkingAUserClearsAnyPreviouslyTypedEmail() {
        WSM_DW_Alert_Recipient__c seeded = [SELECT Id FROM WSM_DW_Alert_Recipient__c LIMIT 1];
        User me = [SELECT Id, Email FROM User WHERE Id = :UserInfo.getUserId()];

        Test.startTest();
        WSM_DW_AlertSettingsController.saveSettings(
            JSON.serialize(new List<Map<String, Object>>{
                new Map<String, Object>{
                    'id' => seeded.Id,
                    'name' => 'Ops Inbox',
                    'email' => 'ops@example.com',
                    'userId' => me.Id,
                    'isActive' => true
                }
            }),
            validThresholds(),
            EMPTY_LIST,
            EMPTY_LIST,
            null
        );
        Test.stopTest();

        WSM_DW_Alert_Recipient__c stored = [
            SELECT Email__c, Effective_Email__c FROM WSM_DW_Alert_Recipient__c WHERE Id = :seeded.Id
        ];
        System.assertEquals(
            null,
            stored.Email__c,
            'Linking a user must clear the old typed address, not leave it looking authoritative'
        );
        System.assertEquals(me.Email, stored.Effective_Email__c, 'The user address takes over');
    }

    @IsTest
    static void rejectsSenderThatIsNotAnOrgWideAddress() {
        String err = saveExpectingError(
            validRecipients(),
            validThresholds(),
            'definitely-not-verified@example.com'
        );
        System.assert(
            err.contains('not a verified organization-wide email address'),
            'An unverified sender would fail silently at midnight, so it must be rejected. Got: ' + err
        );
    }

    @IsTest
    static void blankSenderIsAllowedAndClearsTheSetting() {
        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                validRecipients(),
                validThresholds(),
                EMPTY_LIST,
                EMPTY_LIST,
                null
            );
        Test.stopTest();

        System.assertEquals(
            null,
            dto.senderAddress,
            'A blank sender is a valid choice meaning "send no alert emails"'
        );
    }

    @IsTest
    static void acceptsAVerifiedOrgWideAddress() {
        List<OrgWideEmailAddress> owea = [
            SELECT Address FROM OrgWideEmailAddress LIMIT 1
        ];
        if (owea.isEmpty()) {
            // Org-wide addresses cannot be created in a test context, so there is
            // nothing to assert against in an org that has none.
            return;
        }

        Test.startTest();
        WSM_DW_AlertSettingsController.SettingsDTO dto =
            WSM_DW_AlertSettingsController.saveSettings(
                validRecipients(),
                validThresholds(),
                EMPTY_LIST,
                EMPTY_LIST,
                owea[0].Address
            );
        Test.stopTest();

        System.assertEquals(
            owea[0].Address,
            dto.senderAddress,
            'The chosen sender should round-trip through the custom setting'
        );
        System.assert(!dto.senders.isEmpty(), 'The picker should list the available senders');
    }

    @IsTest
    static void blankJsonInputsAreTreatedAsEmpty() {
        String err = saveExpectingError(null, null);
        System.assert(
            err.contains('at least one active threshold'),
            'Null input should behave like an empty list, not throw a parse error. Got: ' + err
        );
    }
}