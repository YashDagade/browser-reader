# Tempo

**More reading. Less friction.** A small Chrome extension that reads articles aloud, highlights the current word, and stays out of the way.

Built for essays, blog posts, and technical reading. Open a page, click Tempo, and press **Start reading**. Use a browser voice immediately, or connect OpenAI for a more expressive voice. There is no account system, hosted backend, or build step.

## What it does

- A compact floating player with play, pause, stop, previous/next passage, and a position slider.
- **0.75×–4× speed**, adjustable while listening, with pitch-preserving OpenAI playback.
- Word highlighting, optional automatic scrolling, and click-a-word seeking.
- Local article extraction that skips common ads, navigation, forms, and captions. No LLM summarizes or rewrites the page.
- Selected-text reading and a paste-text option for unusual layouts.
- OpenAI voices through `gpt-4o-mini-tts`, `tts-1`, and `tts-1-hd`, plus a browser voice option.
- A short first audio chunk, bounded prefetch, and memory caches to reduce waiting and repeated speech requests.

**A few honest limits:** OpenAI audio needs an initial buffer, and fast playback can catch up with generation. Its word highlighting and seeking use estimated timestamps, not forced alignment. Browser voices use word events when available. Tempo works on ordinary readable webpages; it cannot run on Chrome internal pages, the Chrome Web Store, or the built-in PDF viewer. It does not bypass paywalls or reveal collapsed content.

## Get started

You need Chrome 116 or later. The browser voice works without Node or an API key.

1. Download or clone this repository to a folder you will keep: `git clone https://github.com/YashDagade/browser-reader.git`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked**, then select this repository's **`extension`** folder.
4. Pin **Tempo · Article Reader** from Chrome's extensions menu.
5. Open an article, click Tempo, and press **Start reading**.

To read one passage, select it before opening Tempo. If extraction misses the text you want, open the player's settings and choose **Read your own text**.

### Connect OpenAI voices

The optional speech bridge needs **Node.js 22+** and an OpenAI API key with access to a supported speech model. API usage is billed to the key's project.

1. In the repository root, create a private `.env.local` file and set `OPENAI_API_KEY` to your API key. Keep the actual value out of source files, screenshots, and commits. You can also supply `OPENAI_API_KEY` through your shell environment.
2. In that folder, run:

   ```sh
   npm start
   ```

3. Leave the terminal running. Open Tempo's player settings, choose **OpenAI · expressive**, and try **Coral**, **Marin**, or **Cedar**.

No `npm install` is needed to run the bridge: it uses Node's standard library. The service listens only on `127.0.0.1:43123`. On macOS, `Start Tempo.command` is an alternative launcher. For background startup at login, stop any terminal instance and run `npm run service:install`. After a key change, run `npm run service:restart`; remove background startup with `npm run service:uninstall`.

OpenAI narration is AI generated. The expressive model receives instructions to read the source verbatim and handle scientific terminology carefully; correct pronunciation of every technical term is not guaranteed.

### Controls

| Action | Control |
| --- | --- |
| Open the reader | Toolbar icon, page context menu, or `Alt+Shift+R` (`Option+Shift+R` on Mac) |
| Play / pause | Main button or `Alt+Space` while the page is focused |
| Pause | `Escape` while the page is focused |
| Change speed | Speed button → slider or preset |
| Jump within the article | Click a non-link word or move the position slider |
| Move between passages | Previous / next buttons |
| Reset or close | Stop button or close button; closing also stops playback |

Chrome may reserve a shortcut or let another extension claim it. Change Tempo's opening shortcut at `chrome://extensions/shortcuts`.

### Multiple Chrome profiles

Load the same `extension` folder once in each profile. All profiles can use the same running local bridge; voice and speed preferences are saved separately in each profile. Each profile has one active Tempo reading session. Starting another article replaces that session.

## Privacy and credentials

Tempo injects its reader into the active tab only after you invoke it. It has no analytics and does not require access to all website content in advance. Article text is held in the reading session; settings are stored locally in Chrome.

Browser mode uses Chrome's speech interface and requires an installed, non-remote voice. OpenAI mode sends the current text chunk and a few upcoming chunks through the local bridge to OpenAI. It does not send the page's HTML, cookies, or browsing history. The API key stays in the local bridge process and never goes into the extension or webpage. Audio caches are memory-only and bounded; restarting the bridge clears its cache.

`.env.local`, other environment files, and local output are excluded from Git. Ignore rules protect untracked files, not secrets previously committed to history. Never commit a real key. The repository does not require or store GitHub credentials.

The bridge rejects website origins and checks request headers. By default, Chrome extension origins are allowed; to restrict it to your Tempo installations, set `READER_EXTENSION_IDS` to their comma-separated IDs in your private environment file. Find each ID at `chrome://extensions`, then restart the bridge. The bridge is intended for a trusted personal computer, not as a public service.

## Troubleshooting

- **OpenAI is unavailable:** start the bridge, confirm that its key is configured, and check the connection from Tempo's extension options. Browser voice remains a separate option.
- **Wrong passage or missing text:** close Tempo, select the desired passage, and reopen it; or paste the text in settings. Reloading a page or changing its content can invalidate old word positions.
- **Highlighting drifts:** OpenAI timestamps are approximate. Click near the desired word to reposition, or use browser voice if its word events suit your reading better.
- **Changes are not visible:** click **Reload** for Tempo at `chrome://extensions`, then reload the article tab.
- **No browser speech:** check system audio and installed speech voices. Browser voice quality and event support vary by operating system.

## Development

```sh
npm install
npm test
npm run check
```

The extension is plain JavaScript, HTML, and CSS. `jsdom` is a development-only dependency for tests. The test suite covers text extraction, player behavior, audio scheduling, and the local bridge with mocked speech responses; it does not spend API credits.

See [the architecture notes](docs/architecture.md) for the data flow, timing tradeoffs, and security boundaries. Contributions that improve extraction, accessibility, and playback reliability are welcome. Please include a reproducible example without private page content or credentials.

Licensed under [MIT](LICENSE).

## Demo

[![Tempo walkthrough: a quiet Chrome player with word highlighting and adjustable speed](docs/demo-poster.png)](docs/tempo-demo.mp4)

[Watch the 28-second walkthrough (MP4)](docs/tempo-demo.mp4). This silent, captioned video uses real Chrome captures and original sample text. It shows playback highlighting, the 4× speed setting, and a word selected for seeking; OpenAI word timing and seeking are approximate.

Tempo keeps the article in place and adds a small player. Text extraction runs locally, short audio chunks keep playback responsive, and speed changes happen in the player without generating the audio again. Use OpenAI for natural voices or an installed browser voice for local speech.

To try the same sample article, run `npm run demo`, open the local address printed in the terminal, and start Tempo from the Chrome toolbar.
