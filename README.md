# Hermes

**Your reading. At your pace.** A small Chrome extension for listening to articles, essays, and technical writing without leaving the page.

Click **Start reading**, follow the highlighted words, and change speed from **0.75× to 4×**. Use an installed browser voice or connect OpenAI directly from Chrome. No Node, backend, or build step is needed for either option.

- A readable floating player with play, pause, stop, passage skipping, and a position slider.
- Drag it anywhere, dock it left or right, or collapse it to a small movable button while listening.
- Click a word to jump there, follow along with optional auto-scroll, or read selected/pasted text.
- Local article extraction skips common navigation, ads, controls, and captions. No LLM rewrites the article.
- OpenAI voices including **Alloy**, **Cedar**, and **Nova**, with delivery and pronunciation guidance for `gpt-4o-mini-tts`.
- Short initial audio chunks, bounded prefetch, and optional background word alignment. Speed changes apply to buffered audio without regenerating it.

## Install and listen

Requires **Chrome 116+**. This is an unpacked extension, not a Chrome Web Store listing.

1. [Download `hermes-extension.zip`](https://github.com/YashDagade/browser-reader/releases/latest/download/hermes-extension.zip) and extract it to a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted **`extension`** folder.
4. Pin **Hermes · Article Reader** from Chrome's extensions menu.
5. Open an article, click Hermes, then **Start reading**. The default browser voice needs no API key.

You can also [clone the repository](https://github.com/YashDagade/browser-reader) and load its `extension` folder. Keep the installed folder in place. After updating its files, click **Reload** at `chrome://extensions` and reload the article tab.

### Connect OpenAI

1. Right-click Hermes in Chrome's toolbar and open **Options**.
2. Under **How to connect**, choose **Direct from Chrome · no Node or server**.
3. Enter your own OpenAI API key, or import a local `.env.local` file containing `OPENAI_API_KEY`. The file is read locally and is not uploaded.
4. Click **Save connection** and allow the optional permission to access `api.openai.com`.
5. Choose **OpenAI · expressive** and a voice in the player. Try Alloy, Cedar, or Nova.

**The direct-mode key is stored unencrypted in local Chrome storage.** Only trusted extension contexts can access it; it is never synced or sent to webpage content scripts. Protect your Chrome profile. **Forget saved key** removes it and the OpenAI permission. The first speech request verifies the key.

For file-based setup, create a file named `.env.local` on your computer with one line: `OPENAI_API_KEY=your_own_key_here` (replace the placeholder locally). If you cloned the repository, copy `.env.example` to `.env.local` first. Import that private file in Options; do not put the key in extension source files.

OpenAI speech is AI generated and billed to your API project. Voice instructions apply only to `gpt-4o-mini-tts`; older models and browser voices do not support them. Hermes asks for verbatim reading and careful pronunciation of jargon. See [OpenAI's speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

### Optional local helper

To keep the key outside Chrome, clone the full repository, install **Node.js 22+**, and set `OPENAI_API_KEY` in a private `.env.local` file at the repository root. Then run:

```sh
npm start
```

Choose **Local helper** in Options and save. The helper needs no dependency installation and listens only on `127.0.0.1:43123`; leave it running. On macOS, use `Start Hermes.command` or install startup at login with `npm run service:install` after stopping any terminal instance. `npm run service:restart` reloads a changed key; `npm run service:uninstall` removes background startup.

Install the extension separately in each Chrome profile. Direct keys and preferences stay separate per profile; multiple profiles can share one local helper. Each profile has one active reading session.

## Make it your pace

| Action | Control |
| --- | --- |
| Open Hermes | Toolbar icon, page context menu, or `Alt+Shift+R` (`Option+Shift+R` on Mac) |
| Play / pause | Main button or `Alt+Space` while the page is focused |
| Pause | `Escape` while the page is focused |
| Change speed or voice | Speed button or player settings |
| Seek | Click a non-link word or use the position slider |
| Move between passages | Previous / next buttons |
| Move / dock / collapse | Drag handle, position settings, or collapse button |
| Reset or close | Stop or close; closing stops playback |

Select a passage before opening Hermes to read just that selection. **Read your own text** accepts pasted text without page highlighting. Customize the opening shortcut at `chrome://extensions/shortcuts` if another app claims it.

**Word timing:** **Improve timing** matches background `whisper-1` transcription timestamps to the source. Playback starts without waiting; estimates remain while alignment is pending or unavailable. This adds API usage and is not perfectly exact. Choose **Lightweight** to disable it. Browser voices use native word events when available. See [OpenAI's transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

**Time remaining** appears as minutes:seconds. Buffered audio uses measured durations; passages not yet generated and browser speech use estimates. Playback speed is reflected in the countdown.

## Privacy and limits

Hermes runs on the active tab only when invoked, with no analytics. OpenAI receives current and prefetched text, plus generated audio for improved timing; page HTML, cookies, and browsing history are not sent. Browser mode requires an installed, non-remote voice.

Audio stays in memory. The extension caps retained audio at **12 MiB**, creates its audio document when needed, and releases it on stop/close or after three idle minutes. It does not poll playback while idle. The helper's **16 MiB** audio cache expires after ten minutes. These are cache limits, not total RAM limits.

Environment and common credential files are Git-ignored; no key is bundled in the source or extension ZIP. The helper rejects website origins and supports an optional extension-ID allowlist. See [security and data flow](docs/architecture.md#credentials-and-request-boundaries).

OpenAI needs an initial buffer; fast playback and chunk transitions can cause gaps. Unusual layouts may require selecting or pasting text. Chrome internal pages, the Web Store, and the built-in PDF viewer are unsupported. Hermes does not bypass paywalls or reveal collapsed content.

If speech fails, check your connection settings or installed system voices. If extraction misses, close Hermes and reopen it with the desired passage selected.

## Development

```sh
npm install
npm test
npm run check
npm run check:secrets
npm run package
```

Plain JavaScript, HTML, and CSS; `jsdom` is development-only. Mocked tests spend no API credits. Packaging writes `output/hermes-extension.zip`. See [the architecture notes](docs/architecture.md). Reproducible contributions are welcome; keep private content and credentials out of issues.

Licensed under [MIT](LICENSE).

## Demo

[![Hermes: a movable Chrome reader with highlighting, voice controls, and adjustable speed](docs/demo-poster.png)](docs/hermes-demo.mp4)

[Watch the 35-second walkthrough (MP4)](docs/hermes-demo.mp4). This silent, captioned demo uses real Chrome captures and original sample text.

Hermes keeps the article in place and adds a player you can move out of the way. Text extraction runs locally, short audio chunks keep playback responsive, and speed changes happen in the player. Use OpenAI for expressive voices or an installed browser voice for local speech. To try the sample article, run `npm run demo` from the full repository and open the local address printed in the terminal.
