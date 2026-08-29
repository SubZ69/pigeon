UUID = pigeon@subz69.github
POT_FILE = po/pigeon.pot
PO_FILES = $(wildcard po/*.po)
LANGUAGES = $(patsubst po/%.po,%,$(PO_FILES))
JS_FILES = $(wildcard src/*.js)

VERSION = $(shell grep -o '"version-name": *"[^"]*"' src/metadata.json | cut -d'"' -f4)
ZIP = $(UUID).shell-extension.zip

.PHONY: all install uninstall po new-po release lint clean help

all:
	@gnome-extensions pack --force --podir=../po --extra-source=manager.js --extra-source=account.js --extra-source=providers.js --extra-source=imap.js src

lint:
	@uvx shexli $(CURDIR)/src

po:
	@xgettext --from-code=UTF-8 \
		--output=$(POT_FILE) \
		--package-name="$(UUID)" \
		--keyword=_ \
		--add-location=file \
		$(JS_FILES)
	@sed -i 's/charset=CHARSET/charset=UTF-8/' $(POT_FILE)
	@echo "Updated $(POT_FILE)"
	@for lang in $(LANGUAGES); do \
		msgmerge --update --backup=none po/$$lang.po $(POT_FILE); \
		msgattrib --no-obsolete -o po/$$lang.po po/$$lang.po; \
		echo "Updated po/$$lang.po..."; \
	done

install: all
	@gnome-extensions install $(ZIP) --force
	@$(MAKE) --no-print-directory clean
	@echo "Done, restart GNOME Shell to apply changes."

uninstall:
	@gnome-extensions uninstall $(UUID)
	@echo "Uninstallation complete."

new-po: po
ifndef LANG
	$(error Usage: make new-po LANG=xx)
endif
	@msginit --input=$(POT_FILE) --output=po/$(LANG).po --locale=$(LANG) --no-translator

release: all
	@gh release create v$(VERSION) $(ZIP) --title "v$(VERSION)" --generate-notes
	@$(MAKE) --no-print-directory clean
	@echo "Released v$(VERSION)"

clean:
	@rm -f $(ZIP)

help:
	@echo "Makefile targets:"
	@echo ""
	@echo "  make                 Create extension package"
	@echo "  make install         Build and install extension"
	@echo "  make uninstall       Remove installed extension"
	@echo "  make lint            Run shexli"
	@echo "  make po              Update translations"
	@echo "  make new-po LANG=xx  Create new translation (e.g., LANG=it)"
	@echo "  make release         Create GitHub release with zip"
	@echo "  make clean           Clean generated package"
