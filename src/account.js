import Gio from 'gi://Gio';
import { gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { providers } from './providers.js';

export class Account {
    constructor({ goaAccount, settings, httpSession, cancellable, logger, notifiedIds }) {
        this.goaAccount = goaAccount;
        this._settings = settings;
        this._httpSession = httpSession;
        this._cancellable = cancellable;
        this._logger = logger;
        this._notifiedIds = notifiedIds;

        const account = goaAccount.get_account();
        this.mailbox = account.presentation_identity;
        this._provider = providers[account.provider_type];
        this._source = null;
        this._failCount = 0;
    }

    async scanInbox() {
        if (this.goaAccount.get_account().mail_disabled) return;

        try {
            const messages = await this._fetchMessages();
            this._failCount = 0;
            this._processNewMessages(messages);
        } catch (err) {
            if (!err.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this._failCount++;
                this._logger.log(`mail check failed (${this._failCount}): ${err.message}`);
                if (this._failCount === 3) {
                    Main.notifyError(this.mailbox, _('Unable to check emails: %s').format(err.message));
                }
            }
        }
    }

    destroy() {
        if (this._source) {
            this._source.destroy();
            this._source = null;
        }
    }

    _fetchMessages() {
        return this._provider.fetchMessages({
            goaObject: this.goaAccount,
            cancellable: this._cancellable,
            httpSession: this._httpSession,
            settings: this._settings,
            logger: this._logger,
            mailbox: this.mailbox,
        });
    }

    _processNewMessages(messages) {
        const currentIds = new Set(messages.map((m) => m.id));
        const ids = this._notifiedIds.get(this.mailbox) || [];

        // Keep only IDs that are still in the current inbox
        const seenIds = new Set(ids.filter((id) => currentIds.has(id)));

        // Oldest first so newest appear on top in notification stack
        const newMessages = [...messages].reverse().filter((msg) => !seenIds.has(msg.id));

        const threshold = this._settings.get_int('group-threshold');
        if (threshold > 0 && newMessages.length >= threshold) {
            const subject = ngettext(
                'You have %d unread email',
                'You have %d unread emails',
                newMessages.length,
            ).format(newMessages.length);
            this._showNotification({
                subject,
                from: this.mailbox,
                link: this._provider.getInboxURL(this.mailbox),
            });
        } else {
            for (const msg of newMessages) {
                this._showNotification(msg);
            }
        }

        for (const msg of newMessages) {
            seenIds.add(msg.id);
        }

        this._notifiedIds.set(this.mailbox, [...seenIds]);
    }

    _showNotification(msg) {
        const source = this._getSource();

        const persistent = this._settings.get_boolean('persistent-notifications');
        const notification = new MessageTray.Notification({
            source,
            title: msg.subject || _('(No subject)'),
            body: msg.from,
            iconName: 'mail-unread',
            urgency: persistent ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
        });

        if (this._settings.get_boolean('play-sound')) {
            notification.sound = new MessageTray.Sound(null, 'message-new-email');
        }

        notification.connect('activated', () => {
            this._openEmail(msg.link);
        });

        source.addNotification(notification);
    }

    _getSource() {
        if (this._source) {
            return this._source;
        }

        this._source = new MessageTray.Source({
            title: this.mailbox,
            iconName: 'mail-message-new',
        });

        this._source.connect('destroy', () => {
            this._source = null;
        });

        Main.messageTray.add(this._source);
        return this._source;
    }

    _openEmail(link) {
        const useMailClient = this._settings.get_boolean('use-mail-client');

        if (!link || useMailClient) {
            const mailto = Gio.app_info_get_default_for_uri_scheme('mailto');
            if (mailto) {
                mailto.launch([], null);
                return;
            }
        }

        if (link) {
            Gio.AppInfo.launch_default_for_uri(link, null);
        }
    }
}
