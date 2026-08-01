import { LightningElement } from 'lwc';

/**
 * Shell for the WSM Agentforce Tools app page. Each tool is a tab.
 *
 * The calculator is eager because it is the default tab and costs nothing to
 * render. Anything that talks to the server is guarded by lwc:if so it never
 * provisions until someone actually opens that tab.
 */
export default class WsmAgentforceTools extends LightningElement {
    activeTab = 'calculator';
    alertsLoaded = false;

    handleTabActive(event) {
        this.activeTab = event.target.value;
        if (this.activeTab === 'alerts') {
            // Latches on first open so the settings tab keeps its state when the
            // user switches back and forth, but costs nothing until first opened.
            this.alertsLoaded = true;
        }
    }
}
