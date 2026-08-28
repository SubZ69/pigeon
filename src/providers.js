import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Xmlb from 'gi://Xmlb';

import { ImapClient } from './imap.js';

async function fetchMessagesOAuth2(
    provider,
    { goaObject, cancellable, httpSession, settings, mailbox },
) {
    const oauth2 = goaObject.get_oauth2_based();
    const [token] = await oauth2.call_get_access_token(cancellable);

    const priorityOnly = settings.get_boolean('priority-only');
    const url = provider.getApiURL(priorityOnly);

    const request = Soup.Message.new('GET', url);
    request.request_headers.append('Authorization', `Bearer ${token}`);

    const bytes = await httpSession.send_and_read_async(
        request,
        GLib.PRIORITY_DEFAULT,
        cancellable,
    );

    const status = request.get_status();
    if (status !== 200) throw new Error(`HTTP ${status}: ${request.get_reason_phrase()}`);

    const body = new TextDecoder('utf-8').decode(bytes.get_data());
    return provider.parseResponse(body, mailbox);
}

const googleProvider = {
    fetchMessages(params) {
        return fetchMessagesOAuth2(this, params);
    },

    getApiURL(priorityOnly) {
        const label = priorityOnly ? '%5Eiim' : '%5Ei';
        return `https://mail.google.com/mail/feed/atom/${label}`;
    },

    getInboxURL(mailbox) {
        return `https://mail.google.com/mail/u/${mailbox}`;
    },

    parseResponse(body, mailbox) {
        const xml = body.replace(/xmlns="[^"]*"/g, '');

        const builder = new Xmlb.Builder();
        const source = new Xmlb.BuilderSource();
        source.load_xml(xml, Xmlb.BuilderSourceFlags.NONE);
        builder.import_source(source);
        const silo = builder.compile(Xmlb.BuilderCompileFlags.NONE, null);

        let entries;
        try {
            entries = silo.query('feed/entry', null);
        } catch {
            return [];
        }

        return entries.map((entry) => {
            const text = (xpath) => {
                try {
                    return entry.query_text(xpath);
                } catch {
                    return null;
                }
            };
            const href = entry.query_attr('link', 'href');
            return {
                id: text('id'),
                subject: text('title'),
                from: `${text('author/name') || ''} <${text('author/email') || ''}>`,
                link: href
                    ? href.replace(
                          'https://mail.google.com/mail',
                          `https://mail.google.com/mail/u/${mailbox}`,
                      )
                    : this.getInboxURL(mailbox),
            };
        });
    },
};

const microsoftProvider = {
    fetchMessages(params) {
        return fetchMessagesOAuth2(this, params);
    },

    getInboxURL() {
        return 'https://outlook.live.com';
    },

    getApiURL(priorityOnly) {
        const filter = priorityOnly
            ? "isRead eq false and inferenceClassification eq 'focused'"
            : 'isRead eq false';
        return `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$select=from,subject,webLink,id`;
    },

    parseResponse(body) {
        const data = JSON.parse(body);
        return (data.value || []).map((msg) => {
            const addr = msg.from?.emailAddress;
            return {
                id: msg.id,
                subject: msg.subject,
                from: addr ? `${addr.name} <${addr.address}>` : '',
                link: msg.webLink || this.getInboxURL(),
            };
        });
    },
};

const imapProvider = {
    getInboxURL() {
        return null;
    },

    async fetchMessages({ goaObject, cancellable, logger }) {
        const mail = goaObject.get_mail();
        if (!mail) throw new Error('IMAP account does not have Mail interface');
        if (!mail.imap_host) throw new Error('IMAP account is missing imap_host configuration');
        if (!mail.imap_use_ssl && !mail.imap_use_tls)
            throw new Error('IMAP requires SSL/TLS or STARTTLS');

        const useStartTls = !mail.imap_use_ssl && mail.imap_use_tls;
        const defaultPort = useStartTls ? 143 : 993;
        const [host, portStr] = mail.imap_host.split(':');
        const port = portStr ? parseInt(portStr, 10) : defaultPort;
        const username = mail.imap_user_name || mail.email_address;

        const passwordBased = goaObject.get_password_based();
        if (!passwordBased) throw new Error('IMAP account does not have password');

        const [password] = await passwordBased.call_get_password('imap-password', cancellable);

        const client = new ImapClient({
            host,
            port,
            username,
            password,
            useStartTls,
            cancellable,
            logger,
        });

        try {
            await client.connect();
            await client.selectMailbox('INBOX');
            const unreadIds = await client.searchUnread();
            const messages = await client.fetchMessages(unreadIds);
            return messages;
        } finally {
            await client.logout();
        }
    },
};

export const providers = {
    google: googleProvider,
    ms_graph: microsoftProvider,
    imap_smtp: imapProvider,
};
