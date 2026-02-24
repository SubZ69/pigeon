# Pigeon Email Notifier

[![License: GPL v2+](https://img.shields.io/badge/License-GPL%20v2+-blue.svg)](LICENSE)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48+-blue.svg)](https://gitlab.gnome.org/GNOME/gnome-shell)

A GNOME Shell extension for email notifications using GNOME Online Accounts.

![Screenshot](assets/screenshot.png)

## Features

- Gmail, Outlook, and IMAP support via GNOME Online Accounts
- Desktop notifications for new emails
- Priority-only mode for important emails (disabled by default, Gmail/Outlook only)
- Persistent notifications (disabled by default)
- Sound notification (disabled by default)
- Click notification to open email in browser or launch default mail client

## Limitations

- Exchange accounts are not supported
- Outlook notifications require GNOME Online Accounts ≥ 3.55. Older versions use a Microsoft API that has been decommissioned.

## Requirements

- GNOME Shell 48 or later
- A Google, Microsoft, or IMAP account configured in GNOME Online Accounts **Settings > Online Accounts**
- **Debian-based:** `sudo apt install gir1.2-goa-1.0 gir1.2-xmlb-2.0`
- **openSUSE:** `sudo zypper install typelib-1_0-Goa-1_0 typelib-1_0-Xmlb-1_0`
- **Gentoo:** Ensure `dev-libs/libxmlb` is installed with the `introspection` USE flag
- **Log out and back in after installing dependencies**

## Installation

### From extensions.gnome.org

[Pigeon Email Notifier on EGO](https://extensions.gnome.org/extension/9301/pigeon-email-notifier/)

### Manual

```bash
git clone https://github.com/subz69/pigeon 
cd pigeon
make install
```

Then restart GNOME Shell and enable the extension.

## Troubleshooting

**No notifications appearing?**
- Ensure you have a Google, Microsoft, or IMAP account added in Settings > Online Accounts
- Check that accounts are enabled and authorized
- For IMAP accounts, verify your server settings and credentials are correct

**Unable to check emails?**
- Re-authenticate your account in Settings > Online Accounts
- Remove and re-add the account if issues persist
- View logs: `journalctl --grep="pigeon"` for details

**Found a bug or issue?**

Please [open an issue](https://github.com/subz69/pigeon/issues) with the relevant output of:
```bash
journalctl --grep="pigeon"
```

## Contributing

### Translations

Pigeon supports internationalization. To add a new translation:

1. Generate a new translation template:
   ```bash
   make new-po LANG=xx  # Replace 'xx' with your language code (e.g., ja, nl, ru)
   ```

2. Edit the generated `po/xx.po` file with your translations

3. Test your translation:
   ```bash
   make install
   ```

4. Submit a pull request with your `po/xx.po` file

## Credits

Based on [gnome-email-notifications](https://github.com/shumingch/gnome-email-notifications) by Shuming Chan, Stuart Langridge and Adam Jablonski. Complete rewrite for GNOME Shell 48+.

Logo based on [Animal Pack Redux](https://kenney.nl/assets/animal-pack-redux) by Kenney.nl (CC0).

## License

Copyright (C) 2026 subz69  
Licensed under [GPL-2.0-or-later](LICENSE).
