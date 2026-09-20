# Chrome Web Store submission

**Submitted version: 0.4.0. Status on September 20, 2026: submitted for review; not yet approved or publicly available.** The dashboard confirmed "Your extension was submitted for review" after contact-email verification. Automatic publication after approval is enabled, with public distribution in all available regions. The item ID is `gfhgncidbgdpeoniaenjdkoepbneldjp`. This file records listing text, disclosure rationale, and reviewer instructions; submission is not evidence of store acceptance. The publisher's account address is intentionally absent from public source.

## Listing fields

| Field | Submitted value |
| --- | --- |
| Name | Hermes · Article Reader |
| Summary | Your articles, at your pace. Fast speech, word highlighting, and a quiet floating player. |
| Category | Accessibility |
| Language | English |
| Website | [Project homepage](https://github.com/YashDagade/browser-reader) |
| Support | [Issue tracker](https://github.com/YashDagade/browser-reader/issues) |
| Privacy policy | [Public policy URL](https://github.com/YashDagade/browser-reader/blob/main/PRIVACY.md) |
| Pricing | No extension purchase or Hermes subscription. Optional OpenAI usage is billed to the user's own API project. |

The privacy-policy URL must be publicly readable after the policy is pushed. Do not provide a developer API key, private email address, or private account information in the public listing or review instructions.

### Detailed description

Hermes reads articles, essays, selected passages, and pasted text aloud without taking you away from the webpage.

Start with an installed on-device voice, or connect your own OpenAI API key for expressive AI narration. Direct OpenAI mode works from Chrome with no Node installation or hosted backend. OpenAI usage is billed to your own API project.

Reading controls:

- Adjust speed from 0.75× to 4×. The toolbar cycles common speeds; settings provide a slider.
- Follow highlighted words, double-click a word to seek, and skip between passages.
- Drag the player, drop it near an edge to dock, or collapse it while listening.
- Let auto-scroll follow the narration, or scroll manually without immediately being pulled back.
- Read a selected passage or paste your own text when a page's layout is unusual.

Hermes extracts text locally and skips common navigation, advertisements, signup controls, and captions. It does not summarize or rewrite your article. OpenAI word timing can improve through optional background transcription; estimates remain when alignment is unavailable. Timing and technical pronunciation are not guaranteed to be exact.

Privacy and setup:

- On-device voices send no text to OpenAI.
- OpenAI narration requires an explicit data-sharing choice. Narration text, a few upcoming passages, and applicable voice guidance go to OpenAI. Improved timing also sends generated audio.
- The direct-mode key and voice instructions last for the current browser session. They are not synced or persistently saved by Hermes.
- Audio is cached locally with encryption for reuse within the same browser session. Clear it from Options.
- No Hermes account, analytics, advertising, or developer-operated content service.

Designed for desktop Chrome. Chrome internal pages, the Web Store, and the built-in PDF viewer are unsupported. Hermes does not bypass paywalls. OpenAI needs an initial audio buffer, and fast playback can sometimes catch up with generation. This package does not run on iPhone, iPad, or Safari.

## Privacy practices fields

**Single purpose:** Read the webpage text, selection, or pasted passage chosen by the user aloud, with playback-speed controls, highlighting, and navigation through the same text.

Use the dashboard's actual field labels. These declarations describe data handled by the extension, including local processing and third-party API requests; they must not be replaced by “no data collected” merely because the developer has no server. Google's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly includes local handling, and its [privacy-field guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) requires consistency with the privacy policy.

| Data category | Disclosure and scope |
| --- | --- |
| Website content | Disclose. User-invoked article/selection/pasted text, generated narration, and timing results are processed to provide reading. Consent controls transfer to OpenAI. |
| Authentication information | Disclose. The user's own OpenAI key is handled in session memory and sent only to OpenAI for authentication, or read by the optional local helper. |
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
| `storage` | Store nonsecret preferences, temporary session state and credentials, and the bounded encrypted audio cache. No Chrome Sync is used. |
| `offscreen` | Play generated audio independently of the page UI and manage its bounded audio resources. The document is released on stop/close or idle cleanup. |
| `contextMenus` | Provide the user-invoked “Read with Hermes” page/selection action. |
| `tts` | Use installed non-remote system voices without an OpenAI key or network narration request. |
| `alarms` | Release an inactive audio document after three idle minutes; not used to poll browsing activity. |
| `http://127.0.0.1:43123/*` | Connect only to the optional same-computer speech helper. The helper keeps a user's private API key outside Chrome; it is not required for direct mode or on-device speech. |
| Optional `https://api.openai.com/*` | Request OpenAI speech/transcription only after the user chooses direct mode, consents, and grants the permission. |

**Remote code answer: No.** Runtime JavaScript, HTML, and CSS are bundled. The OpenAI responses are audio or transcription data, not executable code. The optional local helper runs separately and does not supply executable extension code. This distinction follows the store's [remote-code declaration guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#declare_any_remote_code).

## Reviewer instructions

No Hermes login or developer-supplied API credential is required to test the main reading flow.

1. Install the uploaded extension in desktop Chrome. Ensure an on-device text-to-speech voice is installed and system audio is enabled.
2. Open a public article with visible prose, pin Hermes, click its toolbar icon, then **Start reading**. The default on-device voice should narrate without any OpenAI request.
3. Test play/pause/stop, passage skipping, highlighting, and double-click seeking on a non-link word. Browser word-event support varies by voice.
4. Cycle the toolbar speed button and use the 0.75×–4× slider in settings. Drag near each edge to test docking, then collapse/expand the reader.
5. Close Hermes, select a passage, and reopen it. Test pasted text through **Read your own text**. Pasted text has no page-word highlights.
6. For optional OpenAI testing, open Options, select direct mode, supply a reviewer-owned API key, read the disclosure, check consent, and save. Grant the optional API permission. No developer key is available or necessary for the on-device tests.
7. Choose an OpenAI voice and start reading. No speech/alignment request should occur without consent. Improved timing adds a transcription request; lightweight timing does not. Speed-only changes do not generate new API requests. **Disconnect OpenAI** removes the direct key and permission and resets consent, including when local-helper mode was selected.
8. Close and reopen the reader during the same Chrome session to exercise encrypted audio reuse. Use **Clear saved audio** in Options to remove cached entries. Quit and restart Chrome to verify the direct key and custom instructions must be supplied again and previous audio cannot be decrypted with the new session key.
9. The local helper is an optional alternative: Node 22+, the repository's helper, and a reviewer-owned key in a private environment file. It is not needed to review the packaged extension's default or direct modes.

A page reload or replacement can require reopening the reader. Same-document links should preserve the session. Chrome-restricted pages and PDFs are outside scope. The repository's linked v0.2.0 demo shows an earlier interface; use current screenshots and this release's behavior for review.

## Submission files

Run `npm run package` from the repository root to produce both archives. Upload **`output/hermes-chrome-web-store.zip`** to the publisher dashboard; it has the required root manifest. The general `hermes-extension.zip` is for unpacked installation.

| Asset | File |
| --- | --- |
| Store icon, 128 × 128 | [128.png](../extension/icons/128.png) |
| Small promotional tile, 440 × 280 | [promo-440x280.png](store/promo-440x280.png) |
| Current screenshot, 1280 × 800 | [screenshot-reading.png](store/screenshot-reading.png) |

The screenshot shows v0.4.0 running in desktop Chrome with actual on-device narration and word highlighting. Its original sample essay is included under MIT; it contains no private page content or credentials.

## Submission handoff

Use the store ZIP with `manifest.json` at its root, not the general unpacked-install ZIP that contains an `extension` folder. Confirm its version is 0.4.0 and it contains only extension assets; no environment files, API keys, local helper, test credentials, or private material. Complete the store's listing, privacy, distribution, and reviewer fields in the publisher dashboard, then verify the resulting status there. Uploading a ZIP alone is not submission or approval.

This is a desktop Chrome release. Google's [compatibility guidance](https://support.google.com/chrome_webstore/answer/1698338?hl=en) says mobile devices cannot install Chrome extensions even in desktop mode. iPhone/iPad support would require a separate app or Safari extension port and its own distribution process.
