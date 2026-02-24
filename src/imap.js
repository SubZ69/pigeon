import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class ImapClient {
    constructor({ host, port, username, password, useStartTls = false, cancellable, logger }) {
        this._host = host;
        this._port = port;
        this._username = username;
        this._password = password;
        this._useStartTls = useStartTls;
        this._cancellable = cancellable;
        this._logger = logger;
        this._connection = null;
        this._input = null;
        this._output = null;
        this._commandId = 0;
        this._buffer = '';
    }

    async connect() {
        const client = new Gio.SocketClient();
        client.set_timeout(10);

        this._connection = await client.connect_to_host_async(
            `${this._host}:${this._port}`,
            this._port,
            this._cancellable,
        );

        if (!this._useStartTls) {
            await this._handshakeTls();
        }

        this._input = this._connection.get_input_stream();
        this._output = this._connection.get_output_stream();

        await this._readResponse();

        if (this._useStartTls) {
            await this._upgradeToTls();
        }

        await this._login();
    }

    async _handshakeTls() {
        const identity = Gio.NetworkAddress.new(this._host, this._port);
        const tlsConnection = Gio.TlsClientConnection.new(this._connection, identity);
        // Accept self-signed certificates for localhost (e.g. ProtonMail Bridge)
        if (this._host === '127.0.0.1' || this._host === 'localhost') {
            tlsConnection.connect('accept-certificate', () => true);
        }
        await tlsConnection.handshake_async(GLib.PRIORITY_DEFAULT, this._cancellable);
        this._connection = tlsConnection;
    }

    async _upgradeToTls() {
        const response = await this._sendCommand('STARTTLS');
        if (!response.includes('OK')) {
            throw new Error('STARTTLS failed');
        }
        await this._handshakeTls();
        this._input = this._connection.get_input_stream();
        this._output = this._connection.get_output_stream();
    }

    _quoteString(str) {
        return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    async _login() {
        const user = this._quoteString(this._username);
        const pass = this._quoteString(this._password);
        const response = await this._sendCommand('LOGIN', `${user} ${pass}`);
        if (!response.includes('OK')) {
            throw new Error('IMAP login failed');
        }
    }

    async selectMailbox(mailbox = 'INBOX') {
        const response = await this._sendCommand('SELECT', `"${mailbox}"`);
        if (!response.includes('OK')) {
            throw new Error(`Failed to select mailbox: ${mailbox}`);
        }
    }

    async searchUnread() {
        const response = await this._sendCommand('SEARCH', 'UNSEEN');
        const match = response.match(/\* SEARCH (.+)/);

        if (!match || !match[1].trim()) {
            return [];
        }

        return match[1]
            .trim()
            .split(' ')
            .filter((id) => id);
    }

    async fetchMessages(messageIds, limit = 10) {
        if (messageIds.length === 0) {
            return [];
        }

        const limited = messageIds.slice(-limit);
        const idRange = limited.join(',');
        const response = await this._sendCommand(
            'FETCH',
            `${idRange} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID)])`,
        );

        return this._parseMessages(response);
    }

    async logout() {
        try {
            await this._sendCommand('LOGOUT');
        } catch (err) {
            this._logger?.log(`IMAP logout error: ${err.message}`);
        } finally {
            this._connection?.close(null);
            this._connection = null;
        }
    }

    async _sendCommand(command, args = '') {
        this._commandId++;
        const tag = `A${this._commandId.toString().padStart(4, '0')}`;
        const cmd = args ? `${tag} ${command} ${args}\r\n` : `${tag} ${command}\r\n`;

        const bytes = new GLib.Bytes(new TextEncoder().encode(cmd));
        await this._output.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, this._cancellable);

        return await this._readResponse(tag);
    }

    async _readResponse(tag = null) {
        while (true) {
            const bytes = await this._input.read_bytes_async(
                4096,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
            );

            if (bytes.get_size() === 0) {
                break;
            }

            this._buffer += new TextDecoder('utf-8').decode(bytes.get_data());

            if (tag) {
                if (
                    this._buffer.includes(`${tag} OK`) ||
                    this._buffer.includes(`${tag} NO`) ||
                    this._buffer.includes(`${tag} BAD`)
                ) {
                    const result = this._buffer;
                    this._buffer = '';
                    return result;
                }
            } else {
                if (this._buffer.includes('\r\n')) {
                    const result = this._buffer;
                    this._buffer = '';
                    return result;
                }
            }
        }

        return this._buffer;
    }

    _parseMessages(response) {
        const messages = [];
        const lines = response.split('\n');
        let currentMessage = null;
        let currentHeaders = '';
        let currentUid = null;

        for (const line of lines) {
            const fetchMatch = line.match(/\* (\d+) FETCH/);
            if (fetchMatch) {
                if (currentMessage && currentHeaders) {
                    messages.push(this._parseHeaders(currentUid || currentMessage, currentHeaders));
                }
                currentMessage = fetchMatch[1];
                const uidMatch = line.match(/UID (\d+)/);
                currentUid = uidMatch ? uidMatch[1] : null;
                currentHeaders = '';
            } else if (currentMessage) {
                currentHeaders += line + '\n';
            }
        }

        if (currentMessage && currentHeaders) {
            messages.push(this._parseHeaders(currentUid || currentMessage, currentHeaders));
        }

        return messages;
    }

    _unfoldHeaders(raw) {
        return raw.replace(/\r?\n[ \t]/g, ' ');
    }

    _decodeMimeWord(encoded) {
        try {
            const match = encoded.match(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/);
            if (!match) return encoded;

            const [, charset, encoding, data] = match;

            if (encoding.toUpperCase() === 'B') {
                const bytes = GLib.base64_decode(data);
                return new TextDecoder(charset).decode(bytes);
            }

            if (encoding.toUpperCase() === 'Q') {
                const decoded = data
                    .replace(/_/g, ' ')
                    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
                        String.fromCharCode(parseInt(hex, 16)),
                    );
                return new TextDecoder(charset).decode(
                    new Uint8Array([...decoded].map((c) => c.charCodeAt(0))),
                );
            }

            return encoded;
        } catch {
            return encoded;
        }
    }

    _decodeMime(str) {
        if (!str) return str;
        return str
            .replace(/\?=\s+=\?/g, '?==?')
            .replace(/=\?[^?]+\?[BbQq]\?[^?]*\?=/g, (match) => this._decodeMimeWord(match));
    }

    _parseHeaders(uid, headers) {
        const unfolded = this._unfoldHeaders(headers);
        const fromMatch = unfolded.match(/From: (.+)/i);
        const subjectMatch = unfolded.match(/Subject: (.+)/i);
        const messageIdMatch = unfolded.match(/Message-ID: <(.+?)>/i);

        return {
            id: messageIdMatch ? messageIdMatch[1] : `uid_${uid}`,
            subject: this._decodeMime(subjectMatch ? subjectMatch[1].trim() : '(No subject)'),
            from: this._decodeMime(fromMatch ? fromMatch[1].trim() : '(Unknown sender)'),
            link: null,
        };
    }
}
