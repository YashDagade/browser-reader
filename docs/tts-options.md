# Speech options for Hermes

Research checked September 23, 2026. These are candidates, not integrations or listening-test winners. Hermes still uses OpenAI only.

| Candidate | Native Azure service? | Why audition it |
| --- | --- | --- |
| **MAI-Voice-2-Flash** | Yes, Azure Speech; public preview | First candidate for responsive, expressive reading. |
| **MAI-Voice-2** | Yes, Azure Speech; public preview | Quality-focused long-form narration. |
| **Dragon HD Omni** | Yes, Azure Speech | Expressive voices and word-boundary events that could replace Hermes's separate transcription alignment. |
| **ElevenLabs v3 / Flash v2.5** | Azure private deployment still listed as forthcoming | v3 for expression; Flash for response time. |
| **GPT-4o mini TTS on Azure** | Yes, Direct from Azure | A billing alternative for the model family already used by Hermes. |

Microsoft lists MAI-Voice-2-Flash at **$15 per million characters** and MAI-Voice-2 at **$22 per million characters**. Its advertised inference time for generating 45 seconds of audio is 225 ms for Flash and one second for the quality model. These are vendor inference measurements, not measured network or Hermes startup latency. [Microsoft model page](https://microsoft.ai/models/mai-voice-2/)

The MAI family supports expressive styles through SSML and integrates through Azure Speech. Preview availability and the resource region need checking before adoption. I would audition Harper and Ethan on science-heavy text before choosing a voice. [Azure MAI documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices)

Dragon HD Omni is particularly interesting for highlighting: word events carry text and audio offsets. However, neither Dragon HD nor Omni supports SSML `<prosody>`, so an exact 2.3× rate cannot simply be transferred through that tag. Omni's `cfg_scale` influences speaking speed but is not an equivalent multiplier. [Azure HD voice documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices)

ElevenLabs describes v3 as its expressive model, Flash v2.5 as its roughly 75 ms inference option, and Multilingual v2 as its stable long-form option. Flash's number normalization requires particular care for scientific writing. The latency figure excludes application and network overhead. [ElevenLabs model guide](https://elevenlabs.io/docs/overview/models)

ElevenLabs currently documents private deployments on AWS and Google Cloud, with an Azure offering planned for later in H2 2026. This is not confirmation of a ready-to-use Azure product or credit eligibility. A normal ElevenLabs API integration would have separate billing. [Private deployment documentation](https://elevenlabs.io/docs/overview/capabilities/private-deployment)

Azure also lists `gpt-4o-mini-tts` as a Microsoft-hosted, Direct from Azure model. This offers a possible way to use Azure billing without changing model families; it does not establish a quality advantage over the OpenAI endpoint. [Azure catalog](https://ai.azure.com/catalog/models/gpt-4o-mini-tts?publisher=OpenAI)

## Credits and integration

Microsoft for Startups sponsorship credits cover models sold directly by Azure; partner Marketplace charges are excluded. Other credit programs have their own terms. Confirm the subscription and billing meter before claiming coverage. Hosting a proxy on Azure does not make another provider's API bill eligible. [Microsoft sponsorship coverage](https://learn.microsoft.com/en-us/startups/benefits/technical-benefits/azure-credits/foundry-model-sponsorship-coverage)

Azure Speech would need a provider adapter, resource/region credentials, an explicit host permission, SSML handling, and a timing adapter in Hermes. It would use managed inference, so a GPU server would not be necessary. No alternate-provider resources were provisioned or charged for this research.

## OpenAI generation speed versus playback speed

OpenAI accepts a speech `speed` parameter from 0.25 to 4. Its documentation does not promise better quality than browser pitch-preserving playback or explain whether the parameter changes generation or post-processes the sound. Do not describe it as proven superior expressive delivery. [Speech API reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)

Hermes 0.7 uses a configurable generation speed of 2.3 by default, with local playback adjusted by `requested reading speed / generation speed`. Changing the normal speed control is free of additional speech generation. Changing the generation preference may incur a new request, and slowing a fast recording does not reconstruct the phrasing of a recording generated at 1×. Setting generation to 1× allows comparison with the previous behavior.

A short live Alloy check returned 18.6 seconds at requested 1× and 8.200125 seconds at requested 2.3×. Word alignment succeeded on the faster recording. This verifies functionality on one passage, not comparative sound quality or general latency. The next useful experiment is a matched listening test at 2.3× using the same jargon-rich paragraphs, with startup delay, word omissions, pronunciation, and listening fatigue recorded separately.
