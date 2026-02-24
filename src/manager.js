import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Goa from 'gi://Goa';
import Soup from 'gi://Soup';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Account } from './account.js';
import { providers } from './providers.js';

const SUPPORTED_PROVIDERS = new Set(Object.keys(providers));

Gio._promisify(Goa.Client, 'new', 'new_finish');
Gio._promisify(Goa.OAuth2Based.prototype, 'call_get_access_token', 'call_get_access_token_finish');
Gio._promisify(Goa.PasswordBased.prototype, 'call_get_password', 'call_get_password_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.SocketClient.prototype, 'connect_to_host_async', 'connect_to_host_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
Gio._promisify(Gio.DtlsConnection.prototype, 'handshake_async', 'handshake_finish');

export class Manager {
    constructor({ logger, settings }) {
        this._logger = logger;
        this._settings = settings;

        this._cancellable = new Gio.Cancellable();
        this._accounts = [];
        this._notifiedIds = this._loadNotifiedIds();
        this._httpSession = new Soup.Session();
        this._httpSession.set_timeout(10);

        this._settings.connectObject(
            'changed::check-interval',
            this._restartTimer.bind(this),
            this,
        );

        this._init();
    }

    async _init() {
        try {
            this._goaClient = await Goa.Client.new(this._cancellable);
            this._accounts = this._createAccounts();

            this._goaClient.connectObject(
                'account-added',
                this._onAccountAdded.bind(this),
                'account-removed',
                this._onAccountRemoved.bind(this),
                this,
            );

            if (this._accounts.length === 0) {
                return;
            }

            this._startTimer();
            this._checkAllAccounts();
        } catch (err) {
            if (!err.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this._logger.error(err);
                Main.notifyError('Pigeon', _('Error loading email accounts'));
            }
        }
    }

    destroy() {
        this._cancellable.cancel();

        this._settings.disconnectObject(this);
        this._goaClient?.disconnectObject(this);

        this._stopTimer();

        for (const account of this._accounts) {
            account.destroy();
        }

        this._httpSession.abort();

        this._settings = null;
        this._goaClient = null;
        this._httpSession = null;
        this._cancellable = null;
    }

    get _accountOptions() {
        return {
            settings: this._settings,
            httpSession: this._httpSession,
            cancellable: this._cancellable,
            logger: this._logger,
            notifiedIds: this._notifiedIds,
        };
    }

    _createAccounts() {
        return this._goaClient
            .get_accounts()
            .filter((acc) => SUPPORTED_PROVIDERS.has(acc.get_account().provider_type))
            .map((goaAccount) => new Account({ goaAccount, ...this._accountOptions }));
    }

    async _checkAllAccounts() {
        await Promise.allSettled(this._accounts.map((acc) => acc.scanInbox()));
        this._saveNotifiedIds();
    }

    _startTimer() {
        const interval = this._settings.get_int('check-interval');
        this._timerSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._checkAllAccounts();
            return GLib.SOURCE_CONTINUE;
        });
        this._logger.log(`Started pecking (every ${interval}s)`);
    }

    _stopTimer() {
        if (this._timerSourceId) {
            GLib.Source.remove(this._timerSourceId);
            this._timerSourceId = null;
        }
    }

    _restartTimer() {
        this._stopTimer();
        if (this._accounts.length > 0) {
            this._startTimer();
        }
    }

    _onAccountAdded(_client, goaAccount) {
        const providerType = goaAccount.get_account().provider_type;
        if (!SUPPORTED_PROVIDERS.has(providerType)) {
            return;
        }

        const account = new Account({ goaAccount, ...this._accountOptions });
        this._accounts.push(account);

        if (this._accounts.length === 1) {
            this._startTimer();
        }

        account.scanInbox();
    }

    _onAccountRemoved(_client, goaAccount) {
        const index = this._accounts.findIndex((acc) => acc.goaAccount === goaAccount);

        if (index === -1) {
            return;
        }

        const account = this._accounts[index];
        this._notifiedIds.delete(account.mailbox);
        account.destroy();
        this._saveNotifiedIds();

        this._accounts.splice(index, 1);
        if (this._accounts.length === 0) {
            this._stopTimer();
        }
    }

    _loadNotifiedIds() {
        try {
            const history = JSON.parse(this._settings.get_string('notified-ids') || '{}');
            return new Map(Object.entries(history));
        } catch {
            return new Map();
        }
    }

    _saveNotifiedIds() {
        this._settings.set_string(
            'notified-ids',
            JSON.stringify(Object.fromEntries(this._notifiedIds)),
        );
    }
}
