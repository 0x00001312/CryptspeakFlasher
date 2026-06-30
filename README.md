# Cryptspeak Web Flasher

Flashes [Cryptspeak](https://github.com/cryptspeak/csCardputer) onto an M5Stack Cardputer Adv from the browser, over Web Serial. No extra Software required.

**Use it:** https://cryptspeak.github.io/webFlasher/

## How it works

Fetches the latest release from the firmware repo, checks its SHA-256 against the digest GitHub reports for it, then flashes it with esptool-js. Runs entirely client-side, nothing leaves your machine except the firmware download itself.

Needs Chrome, Edge, or another Chromium-based browser (Web Serial isn't supported elsewhere).

## License

[Apache License 2.0](LICENSE).

`vendor/` holds unmodified third-party code under its own license:
- `esptool-js` — Apache 2.0 ([espressif/esptool-js](https://github.com/espressif/esptool-js))
- `fflate` — MIT ([101arrowz/fflate](https://github.com/101arrowz/fflate))
