# Chrome Web Store submission

**Target version: 0.7.0. Status: prepared, not yet submitted.** This API-only update adds a preferred narration speed (default 2.3×) and includes optional encrypted credential storage and replaces the 0.4.0 package previously submitted on September 20, 2026. The item ID is `gfhgncidbgdpeoniaenjdkoepbneldjp`. Final submission and approval must be verified in the dashboard. The publisher's account address is intentionally absent from public source.

## Listing fields

| Field | Value |
| --- | --- |
| Name | Hermes · Article Reader |
| Summary | Your articles, at your pace. Fast speech, word highlighting, and a quiet floating player. |
| Category | Accessibility |
| Language | English |
| Website | [Project homepage](https://github.com/YashDagade/browser-reader) |
| Support | [Issue tracker](https://github.com/YashDagade/browser-reader/issues) |
| Privacy policy | [Public policy URL](https://github.com/YashDagade/browser-reader/blob/main/PRIVACY.md) |
| Pricing | No extension purchase or Hermes subscription. OpenAI usage is billed to the user's own API project. |

The privacy-policy URL must be publicly readable after the policy is pushed. Do not provide a developer API key, private email address, or private account information in the public listing or review instructions.

### Detailed description

Hermes reads articles, essays, selected passages, and pasted text aloud without taking you away from the webpage.

Connect your own OpenAI API key for expressive AI narration. All voices use OpenAI, and an API connection is required. There is no system-voice fallback. Direct OpenAI mode works from Chrome with no Node installation or hosted backend. OpenAI usage is billed to your own API project.

Reading controls:

- Adjust playback from 0.75× to 4× without regenerating audio. Choose a default OpenAI narration speed in voice preferences (2.3× initially); changing that default can incur new speech requests.
- Follow highlighted words, double-click a word to seek, and skip between passages.
- Drag the player, drop it near an edge to dock, or collapse it while listening.
- Let auto-scroll follow the narration, or scroll manually without immediately being pulled back.
- Read a selected passage or paste your own text when a page's layout is unusual.

Hermes extracts text locally and skips common navigation, advertisements, signup controls, and captions. It does not summarize or rewrite your article. OpenAI word timing can improve through optional background transcription; estimates remain when alignment is unavailable. Timing and technical pronunciation are not guaranteed to be exact.

Privacy and setup:

- No speech request is made until you connect your API key and consent.
- OpenAI narration requires an explicit data-sharing choice. Narration text, a few upcoming passages, and applicable voice guidance go to OpenAI. Improved timing also sends generated audio.
- Optionally remember your API key encrypted in this Chrome profile, so it survives browser restarts. The decryption key stays in the same profile; this is not OS keychain protection. Without remembering, the key lasts only for the current session. Voice guidance is always session-only. Nothing is synced.
- Audio is cached locally with encryption for reuse within the same browser session. Clear it from Options.
- No Hermes account, analytics, advertising, or developer-operated content service.

Designed for desktop Chrome. Chrome internal pages, the Web Store, and the built-in PDF viewer are unsupported. Hermes does not bypass paywalls. OpenAI needs an initial audio buffer, and fast playback can sometimes catch up with generation. This package does not run on iPhone, iPad, or Safari.

## Privacy practices fields

**Single purpose:** Read the webpage text, selection, or pasted passage chosen by the user aloud, with playback-speed controls, highlighting, and navigation through the same text.

Use the dashboard's actual field labels. These declarations describe data handled by the extension, including local processing and third-party API requests; they must not be replaced by “no data collected” merely because the developer has no server. Google's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly includes local handling, and its [privacy-field guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) requires consistency with the privacy policy.

| Data category | Disclosure and scope |
| --- | --- |
| Website content | Disclose. User-invoked article/selection/pasted text, generated narration, and timing results are processed to provide reading. Consent controls transfer to OpenAI. |
| Authentication information | Disclose. The user's own OpenAI key is handled in session memory with opt-in encrypted persistent storage, and sent only to OpenAI for authentication, or read by the optional local helper. |
| Personal communications | Disclose as incidental user-selected content. Hermes can narrate messages or other communications that the user selects or pastes; it has no mail integration or background inbox access. |
| Web history / browsing activity | Disclose narrowly: current document URL and title are held temporarily for the reading session. No history log is collected, and these fields are not sent as API metadata. |
| Personally identifiable, health, financial/payment, or location information | Disclose that these may occur inside text the user chooses to narrate. Hermes has no separate collection or extraction of these categories. Do not certify that they can never be handled; map incidental content to the applicable dashboard categories before submitting. |
| User activity | Playback controls are handled locally to operate the reader; no clickstream, mouse tracking, or usage analytics is collected. If the dashboard's definition includes this functional interaction, explain that narrow scope. |

**Limited use certifications:** The implementation does not sell user data; does not use or transfer it for unrelated purposes, advertising, or profiling; and does not use it for creditworthiness or lending decisions. Its OpenAI transfers provide the reading features the user explicitly enables. Select certifications only after confirming the release still matches [PRIVACY.md](../PRIVACY.md).

### Permission justifications

| Manifest permission | Reviewer-facing justification |
| --- | --- |
| `activeTab` | Read the current page only after the user invokes Hermes, without blanket access to all sites. |
| `scripting` | Inject the bundled extractor, player, and highlighting controls into that invoked tab. |
| `storage` | Store nonsecret preferences, temporary session state, credentials in memory with optional encrypted persistence, and the bounded encrypted audio cache. No Chrome Sync is used. |
| `offscreen` | Play generated audio independently of the page UI and manage its bounded audio resources. The document is released on stop/close or idle cleanup. |
| `contextMenus` | Provide the user-invoked “Read with Hermes” page/selection action. |
| `alarms` | Release an inactive audio document after three idle minutes; not used to poll browsing activity. |
| `http://127.0.0.1:43123/*` | Connect only to the optional same-computer speech helper. The helper keeps a user's private API key outside Chrome; it is not required for direct mode. |
| Optional `https://api.openai.com/*` | Request OpenAI speech/transcription only after the user chooses direct mode, consents, and grants the permission. |

**Remote code answer: No.** Runtime JavaScript, HTML, and CSS are bundled. The OpenAI responses are audio or transcription data, not executable code. The optional local helper runs separately and does not supply executable extension code. This distinction follows the store's [remote-code declaration guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#declare_any_remote_code).

## Reviewer instructions

Hermes has no login or subscription. Audio playback requires a reviewer-owned OpenAI API key with speech access and available API credit; no developer credential is supplied.

1. Install the extension in desktop Chrome and open a public article. Click Hermes. Before API setup, a **Connect OpenAI** prompt should appear; it opens Options. No system voice or speech request should start.
2. In Options, select **Direct from Chrome**, supply a reviewer-owned OpenAI API key, read the disclosure, check consent, and click **Save connection**. Grant the optional OpenAI host permission. Leave **Remember on this device** unchecked to keep the key session-only, or enable it to save an encrypted copy that restores after Chrome restarts. The decryption key also lives in the same Chrome profile.
3. Return to the article and click **Start reading**. The default is Alloy with OpenAI expressive (`gpt-4o-mini-tts`). Test play/pause/stop, passage skipping, highlighting, and double-click seeking on a non-link word.
4. Cycle the toolbar speed button and use the 0.75×–4× slider. Toolbar/slider speed changes must reuse audio without new speech requests. Default narration speed in Voice & reading preferences changes the OpenAI generation parameter; changing it while playing can request new speech. Verify 2.3× generation plus 2.3× playback plays the recording at its original rate. Drag near each edge to dock, then collapse and expand the reader.
5. Close Hermes, select a passage, and reopen it. Test pasted text through **Read your own text**. Pasted text has no page-word highlights.
6. Test another OpenAI voice and optional voice instructions. Improved timing adds transcription requests; lightweight timing does not. No speech or alignment request may occur without consent.
7. **Disconnect OpenAI** removes the direct key and permission and resets consent. Subsequent playback shows setup guidance and does not fall back to browser speech. Invalid API credentials produce an error, not a different voice.
8. Close and reopen the reader during the same Chrome session to exercise encrypted audio reuse. Clear the cache in Options. Quit and restart Chrome to verify custom guidance must be supplied again and previous cached audio cannot be decrypted. A remembered API key must restore automatically; a session-only key must require setup. Uncheck Remember and save to delete the saved credential, then verify it does not restore after another restart.
9. The local Node helper is an optional alternative API transport and also requires a user-owned OpenAI key. It is not required for direct mode.

A page reload or replacement can require reopening the reader. Same-document links should preserve the session. Chrome-restricted pages and PDFs are outside scope. The repository's linked v0.2.0 demo shows an earlier interface; use current screenshots and this release's behavior for review.

## Submission files

Run `npm run package` from the repository root to produce both archives. Upload **`output/hermes-chrome-web-store.zip`** to the publisher dashboard; it has the required root manifest. The general `hermes-extension.zip` is for unpacked installation.

| Asset | File |
| --- | --- |
| Store icon, 128 × 128 | [128.png](../extension/icons/128.png) |
| Small promotional tile, 440 × 280 | [promo-440x280.png](store/promo-440x280.png) |
| Current screenshot, 1280 × 800 | [screenshot-reading.png](store/screenshot-reading.png) |

The screenshot shows the earlier v0.4.0 player and word highlighting; v0.5.0 uses only OpenAI narration. Its original sample essay is included under MIT; it contains no private page content or credentials.

## Submission handoff

Use the store ZIP with `manifest.json` at its root, not the general unpacked-install ZIP that contains an `extension` folder. Confirm its version is 0.7.0 and it contains only extension assets; no environment files, API keys, local helper, test credentials, or private material. Complete the store's listing, privacy, distribution, and reviewer fields in the publisher dashboard, then verify the resulting status there. Uploading a ZIP alone is not submission or approval.

This is a desktop Chrome release. Google's [compatibility guidance](https://support.google.com/chrome_webstore/answer/1698338?hl=en) says mobile devices cannot install Chrome extensions even in desktop mode. iPhone/iPad support would require a separate app or Safari extension port and its own distribution process.
